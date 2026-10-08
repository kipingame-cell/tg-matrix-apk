#!/usr/bin/env python3
"""Publish retained successful main-branch artifacts without replacing release assets."""
import argparse, hashlib, json, os, pathlib, subprocess, tempfile, zipfile

def gh(*args, check=True):
    p = subprocess.run(['gh', *args], text=True, capture_output=True)
    if check and p.returncode:
        raise RuntimeError(p.stderr)
    return p

def api(path):
    return json.loads(gh('api', path).stdout)

def pages(path, key=None):
    number = 1
    while True:
        join = '&' if '?' in path else '?'
        data = api(f'{path}{join}per_page=100&page={number}')
        rows = data[key] if key else data
        yield from rows
        if len(rows) < 100:
            break
        number += 1

def publish(repo, run, files, directory, dry_run=False):
    tag = f'build-{run["run_number"]}-{run["head_sha"][:12]}'
    archive_commit = gh('api', f'repos/{repo}/git/ref/heads/main').stdout
    archive_commit = json.loads(archive_commit)['object']['sha']
    sums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    if dry_run:
        print(json.dumps({'tag':tag,'source':run['head_sha'],'sha256':sums}))
        return
    probe = gh('api', f'repos/{repo}/releases/tags/{tag}', check=False)
    if probe.returncode:
        if '404' not in probe.stderr:
            raise RuntimeError(probe.stderr)
        notes = pathlib.Path(directory)/'notes.md'
        notes.write_text(
            f'Сохранённая успешная сборка #{run["run_number"]}.\n\n'
            f'Исходный коммит сборки: {run["head_sha"]}.\nСнимок архивного тега: {archive_commit}.\nWorkflow: {run["name"]}.\n'
            f'Исходный запуск: {run["html_url"]}.\n\n'
            'Файлы перенесены из артефактов этой сборки без пересборки. Тег указывает на снимок архива, а исходники конкретной сборки — на исходный коммит выше. '
            'APK является debug-сборкой; физическая установка здесь не проверялась. '
            'Постоянство сертификата обновлений зависит от настроек проекта. '
            'Контрольные суммы находятся в SHA256SUMS.txt.\n',encoding='utf-8')
        args=['release','create',tag,'--repo',repo,'--target',archive_commit,
              '--title',f'{repo.split("/")[1]} · build {run["run_number"]}',
              '--notes-file',str(notes),'--draft','--latest=false']
        if any(p.suffix=='.apk' for p in files):
            args.append('--prerelease')
        gh(*args)
        release=api(f'repos/{repo}/releases/tags/{tag}')
    else:
        release=json.loads(probe.stdout)
    assets={a['name']:a for a in release['assets']}
    checksum=pathlib.Path(directory)/'SHA256SUMS.txt'
    checksum.write_text(''.join(f'{sums[p.name]}  {p.name}\n' for p in sorted(files)),encoding='utf-8')
    for p in [*files,checksum]:
        if p.name in assets:
            downloaded=pathlib.Path(directory)/'verify'/p.name
            downloaded.parent.mkdir(parents=True,exist_ok=True)
            with downloaded.open('wb') as stream:
                result=subprocess.run(['gh','api',f'repos/{repo}/releases/assets/{assets[p.name]["id"]}',
                                       '-H','Accept: application/octet-stream'],stdout=stream,stderr=subprocess.PIPE)
            if result.returncode or hashlib.sha256(downloaded.read_bytes()).digest()!=hashlib.sha256(p.read_bytes()).digest():
                raise RuntimeError(f'Existing asset differs, refusing overwrite: {tag}/{p.name}')
        else:
            gh('release','upload',tag,str(p),'--repo',repo)
    # Verify the uploaded bytes before exposing a draft release.
    verify=pathlib.Path(directory)/'verify-all'
    verify.mkdir()
    gh('release','download',tag,'--repo',repo,'--dir',str(verify))
    for p in [*files,checksum]:
        if hashlib.sha256((verify/p.name).read_bytes()).digest()!=hashlib.sha256(p.read_bytes()).digest():
            raise RuntimeError(f'Download verification failed: {tag}/{p.name}')
    if release['draft']:
        gh('release','edit',tag,'--repo',repo,'--draft=false','--latest=false')
    print(f'Published and downloaded-byte verified: {tag}',flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--workflow',action='append',required=True)
    parser.add_argument('--run-id',type=int)
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    repo=os.environ['GITHUB_REPOSITORY']
    private=api(f'repos/{repo}')['private']
    runs=([api(f'repos/{repo}/actions/runs/{args.run_id}')] if args.run_id else
          list(pages(f'repos/{repo}/actions/runs?branch=main&status=success','workflow_runs')))
    expired=0;published=0
    for run in reversed(runs):
        if run['name'] not in args.workflow or run['conclusion']!='success' or run['head_branch']!='main':
            continue
        if run.get('event')=='pull_request' or run.get('head_repository',{}).get('full_name')!=repo:
            continue
        artifacts=list(pages(f'repos/{repo}/actions/runs/{run["id"]}/artifacts','artifacts'))
        with tempfile.TemporaryDirectory() as temp:
            directory=pathlib.Path(temp);files=[]
            for artifact in artifacts:
                if artifact['expired']:
                    expired+=1
                    continue
                archive=directory/f'{artifact["id"]}.zip'
                with archive.open('wb') as stream:
                    result=subprocess.run(['gh','api',f'repos/{repo}/actions/artifacts/{artifact["id"]}/zip'],
                                          stdout=stream,stderr=subprocess.PIPE)
                if result.returncode:
                    raise RuntimeError(result.stderr.decode())
                with zipfile.ZipFile(archive) as zipped:
                    if zipped.testzip():raise RuntimeError('Corrupt artifact ZIP')
                    for item in zipped.infolist():
                        name=pathlib.PurePosixPath(item.filename).name
                        if not name.endswith(('.apk','.pdf')) or 'unsigned' in name.lower():continue
                        if name.endswith('.pdf') and not private:raise RuntimeError('Refusing PDF archive on a public repository')
                        # Artifact-prefixed names avoid collisions between multiple APKs in one run.
                        safe=''.join(c if c.isalnum() or c in '-_.' else '-' for c in artifact['name'])+'-'+name
                        path=directory/safe
                        if path.exists():raise RuntimeError('Duplicate artifact output name')
                        path.write_bytes(zipped.read(item))
                        if path.suffix=='.apk':
                            with zipfile.ZipFile(path) as apk:
                                if apk.testzip() or 'AndroidManifest.xml' not in apk.namelist():raise RuntimeError('Invalid APK archive')
                        files.append(path)
            if files:
                publish(repo,run,files,directory,args.dry_run);published+=1
    print(f'Runs published: {published}; expired artifacts skipped: {expired}. Expired bytes were not reconstructed.')

if __name__=='__main__':main()
