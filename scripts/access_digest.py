#!/usr/bin/env python3
"""접속 코드의 SHA-256 해시를 출력한다 (docs/config/access.json 의 digest 에 넣을 값).
사용: python scripts/access_digest.py   (코드는 화면에 표시되지 않고 입력받음)
"""
import getpass, hashlib
code = getpass.getpass("접속 코드: ").strip()
print(hashlib.sha256(code.encode("utf-8")).hexdigest())
