#!/usr/bin/env python3
"""Run by the owner in their own Cloud Shell. Never prints private signing values."""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

REPO = 'nguyenkhoilevn7-acetropical/Minhsatori'
PIN = 'SATORI_ANDROID_SIGNING_CERT_SHA256'
SECRET_NAMES = {
    'SATORI_ANDROID_KEYSTORE_BASE64', 'SATORI_ANDROID_KEYSTORE_PASSWORD',
    'SATORI_ANDROID_KEY_ALIAS', 'SATORI_ANDROID_KEY_PASSWORD',
}
GH_VERSION = '2.102.0'
GH_SHA256 = 'bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386'


def allow_provisioning(remote_pin, remote_names, local_pin):
    if remote_pin and remote_pin.lower() != local_pin.lower():
        raise RuntimeError('Chứng thư đã đăng ký khác khóa cục bộ. Dừng để không làm mất khả năng cập nhật APK.')
    if not remote_pin and SECRET_NAMES.intersection(remote_names):
        raise RuntimeError('Đã có signing Secrets nhưng chưa có pin chứng thư. Không tự ghi đè khóa cũ.')


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def install_cli(directory):
    existing = shutil.which('gh')
    if existing:
        return existing
    if sys.platform != 'linux' or os.uname().machine != 'x86_64':
        raise RuntimeError('Cần GitHub CLI. Script tự cài chỉ hỗ trợ Linux x86_64 như Cloud Shell.')
    destination = directory / 'tools'
    destination.mkdir(mode=0o700, exist_ok=True)
    executable = destination / f'gh_{GH_VERSION}_linux_amd64/bin/gh'
    if executable.exists():
        return str(executable)
    url = f'https://github.com/cli/cli/releases/download/v{GH_VERSION}/gh_{GH_VERSION}_linux_amd64.tar.gz'
    with urllib.request.urlopen(url, timeout=60) as response:
        archive = response.read(30_000_001)
    if len(archive) > 30_000_000 or hashlib.sha256(archive).hexdigest() != GH_SHA256:
        raise RuntimeError('Không xác minh được GitHub CLI chính thức; chưa cấu hình khóa.')
    with tempfile.NamedTemporaryFile(dir=directory) as temporary:
        temporary.write(archive)
        temporary.flush()
        with tarfile.open(temporary.name) as source:
            # Extract only the official CLI executable, never arbitrary archive paths.
            member = source.getmember(f'gh_{GH_VERSION}_linux_amd64/bin/gh')
            if not member.isfile():
                raise RuntimeError('Gói CLI không hợp lệ.')
            executable.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            with source.extractfile(member) as input_file, executable.open('xb') as output:
                shutil.copyfileobj(input_file, output)
    executable.chmod(0o700)
    return str(executable)


def github(gh, *args, data=None, optional=False):
    result = subprocess.run([gh, *args], input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, check=False)
    if result.returncode:
        if optional:
            return None
        raise RuntimeError('GitHub chưa thực hiện được thao tác ' + args[0] + '. Có thể chạy lại với cùng khóa đã lưu.')
    return result.stdout.decode('utf-8').strip()


def provision(directory):
    if not shutil.which('keytool'):
        raise RuntimeError('Thiếu keytool (JDK). Dừng trước khi tạo khóa hoặc thay đổi GitHub.')
    if directory.is_symlink():
        raise RuntimeError('Thư mục lưu khóa không được là liên kết.')
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    gh = install_cli(directory)
    logged_in_here = False
    try:
        if github(gh, 'auth', 'status', optional=True) is None:
            print('Đăng nhập GitHub trong terminal của anh; không gửi mã hoặc mật khẩu vào chat.', flush=True)
            run([gh, 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key'])
            logged_in_here = True
        login = github(gh, 'api', 'user', '--jq', '.login')
        if login != REPO.split('/')[0]:
            raise RuntimeError('Tài khoản GitHub khác chủ kho Minh Satori. Chưa ghi Secrets.')
        variables = json.loads(github(gh, 'variable', 'list', '--repo', REPO, '--json', 'name,value'))
        remote_pin = next((item['value'] for item in variables if item['name'] == PIN), '')
        listed = github(gh, 'secret', 'list', '--repo', REPO, '--json', 'name')
        remote_names = {item['name'] for item in json.loads(listed)}
        credentials_file = directory / 'signing-credentials.json'
        keystore = directory / 'minhsatori-release.jks'
        if not credentials_file.exists():
            if keystore.exists() or remote_pin or SECRET_NAMES.intersection(remote_names):
                raise RuntimeError('Đã tồn tại khóa hoặc cấu hình ký. Cần khôi phục bộ khóa cũ; không tạo khóa thay thế.')
            credentials = {'alias': 'minhsatori-release', 'password': secrets.token_urlsafe(48)}
            with credentials_file.open('x', encoding='utf-8') as output:
                json.dump(credentials, output)
            credentials_file.chmod(0o600)
        credentials = json.loads(credentials_file.read_text(encoding='utf-8'))
        if not isinstance(credentials.get('password'), str) or len(credentials['password']) < 32:
            raise RuntimeError('Bộ mật khẩu ký không hợp lệ. Không ghi đè hoặc thay khóa.')
        environment = os.environ.copy()
        environment['MINHSATORI_PRIVATE_STORE_PASSWORD'] = credentials['password']
        if not keystore.exists():
            if remote_pin or SECRET_NAMES.intersection(remote_names):
                raise RuntimeError('Khóa đã đăng ký nhưng file gốc bị thiếu. Cần khôi phục, không tạo mới.')
            run(['keytool', '-genkeypair', '-alias', credentials['alias'], '-keyalg', 'RSA',
                 '-keysize', '3072', '-validity', '10000', '-storetype', 'PKCS12',
                 '-keystore', str(keystore), '-storepass:env', 'MINHSATORI_PRIVATE_STORE_PASSWORD',
                 '-keypass:env', 'MINHSATORI_PRIVATE_STORE_PASSWORD',
                 '-dname', 'CN=Minh Satori Android Release,O=Minh Satori,C=VN'],
                env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        keystore.chmod(0o600)
        certificate = subprocess.check_output(['keytool', '-exportcert', '-alias', credentials['alias'],
            '-keystore', str(keystore), '-storepass:env', 'MINHSATORI_PRIVATE_STORE_PASSWORD'],
            env=environment, stderr=subprocess.DEVNULL)
        digest = hashlib.sha256(certificate).hexdigest()
        allow_provisioning(remote_pin, remote_names, digest)
        # Anchor public identity FIRST. Interrupted secret uploads can then safely
        # resume using this exact local key, never regenerate a new certificate.
        if not remote_pin:
            github(gh, 'variable', 'set', PIN, '--repo', REPO, data=digest.encode())
        values = {
            'SATORI_ANDROID_KEYSTORE_BASE64': base64.b64encode(keystore.read_bytes()),
            'SATORI_ANDROID_KEYSTORE_PASSWORD': credentials['password'].encode(),
            'SATORI_ANDROID_KEY_ALIAS': credentials['alias'].encode(),
            'SATORI_ANDROID_KEY_PASSWORD': credentials['password'].encode(),
        }
        for name, value in values.items():
            github(gh, 'secret', 'set', name, '--repo', REPO, data=value)
            print('Đã lưu GitHub Actions Secret:', name, flush=True)
        readback = {item['name'] for item in json.loads(
            github(gh, 'secret', 'list', '--repo', REPO, '--json', 'name'))}
        verified_pin = github(gh, 'variable', 'get', PIN, '--repo', REPO,
                              '--json', 'value', '--jq', '.value')
        if not SECRET_NAMES.issubset(readback) or verified_pin.lower() != digest:
            raise RuntimeError('Chưa xác minh đủ cấu hình ký. Giữ nguyên khóa cục bộ và chạy lại.')
        public = {'package': 'vn.minhsatori.app', 'certificateSha256': digest,
                  'certificateSha1': hashlib.sha1(certificate).hexdigest()}
        (directory / 'public-certificate.json').write_text(json.dumps(public, indent=2) + '\n', encoding='utf-8')
        print('PASS: đã xác minh tên 4 Secrets và pin chứng thư. Giá trị Secrets không được in ra.')
        print(json.dumps(public, indent=2))
        print('Bộ khóa cố định nằm trong thư mục riêng:', directory)
        print('Giữ/sao lưu cả keystore và signing-credentials.json ở nơi riêng tư. Không upload chúng vào chat hoặc mã nguồn.')
        print('Script không sửa main, không deploy Apps Script và không ghi hóa đơn. OAuth và APK release còn cần kiểm thử riêng.')
    finally:
        if logged_in_here:
            github(gh, 'auth', 'logout', '--hostname', 'github.com', optional=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path,
                        default=Path.home() / '.local/share/minhsatori-release-signing')
    args = parser.parse_args()
    try:
        target = args.directory.expanduser().absolute()
        if any((parent / '.git').exists() for parent in [target, *target.parents]):
            raise RuntimeError('Thư mục khóa phải nằm ngoài mọi kho Git.')
        if target.is_symlink():
            raise RuntimeError('Thư mục lưu khóa không được là liên kết.')
        target.mkdir(parents=True, mode=0o700, exist_ok=True)
        target.chmod(0o700)
        with (target / 'provision.lock').open('a') as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            provision(target)
    except (Exception, KeyboardInterrupt) as error:
        # No subprocess payload, token, credential JSON or signing password in errors.
        message = str(error) if isinstance(error, RuntimeError) else 'Chưa hoàn tất. Giữ nguyên bộ khóa đã tạo để tiếp tục; không tạo khóa mới.'
        print('DỪNG:', message, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
