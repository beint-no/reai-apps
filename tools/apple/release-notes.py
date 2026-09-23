#!/usr/bin/env python3
import sys
from build import configuration

app = configuration(sys.argv[1])
connection = ('Open the app, paste a ReAI user access token and the provider credentials, then choose a company and bank account.'
              if sys.argv[1] in {'vipps', 'klarna', 'zettle'} else
              'Open the app, click **Connect to ReAI**, choose a company, and approve in your browser.')
print(f'''Requires Apple Silicon (M1 or newer) and macOS 15 or newer.

1. Download **{app['asset']}** below and open it.
2. Drag **{app['name']}** to **Applications**.
3. {connection}

Signed with our Apple Developer ID and notarized by Apple. No build tools or security-setting changes are needed.
The normal first-open confirmation from macOS may appear.

[App instructions](https://github.com/beint-no/reai-apps/tree/main/{app['path']}) · [All ReAI apps](https://beint-no.github.io/reai-apps/)

To update, quit the app and replace it in Applications. A SHA-256 checksum is included in `SHA256SUMS`.
''')
