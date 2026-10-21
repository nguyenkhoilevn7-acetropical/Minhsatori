"""Fail closed on APK identity, debug status and the pinned release certificate."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


def validate(badging, certificates, expected_digest):
    digest = expected_digest.replace(":", "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("Configure the stable release certificate SHA-256 first")
    if not re.search(r"^package: name='vn\.minhsatori\.app' versionCode='11' versionName='0\\.3\\.4'(?: |$)", badging, re.M):
        raise ValueError("Unexpected APK package or version")
    if re.search(r"^application-debuggable(?:\s|$)", badging, re.M):
        raise ValueError("Debuggable APK cannot be released")
    if re.search(r"CN\s*=\s*Android Debug(?:,|\s|$)", certificates, re.I):
        raise ValueError("Android debug signing key cannot be released")
    fingerprints = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})\s*$", certificates, re.M)
    if len(fingerprints) != 1 or fingerprints[0].lower() != digest:
        raise ValueError("APK signer does not match the pinned release certificate")
    sha1 = re.findall(r"^Signer #1 certificate SHA-1 digest: ([0-9a-fA-F]{40})\s*$", certificates, re.M)
    if len(sha1) != 1:
        raise ValueError("Missing signing SHA-1 required for Android OAuth registration")
    return {"package": "vn.minhsatori.app", "versionName": "0.3.4", "versionCode": 11,
            "certificateSha256": digest, "certificateSha1": sha1[0].lower()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    parser.add_argument("--build-tools", type=Path, required=True)
    parser.add_argument("--certificate-sha256", required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    badging = subprocess.check_output([str(args.build_tools / "aapt"), "dump", "badging", str(args.apk)], text=True)
    certificates = subprocess.check_output([str(args.build_tools / "apksigner"), "verify", "--verbose", "--print-certs", str(args.apk)], text=True)
    report = validate(badging, certificates, args.certificate_sha256)
    report["apkSha256"] = hashlib.sha256(args.apk.read_bytes()).hexdigest()
    report["apkBytes"] = args.apk.stat().st_size
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
