# Windows Time Tracker

Native .NET / WinUI 3 app, Windows 11 25H2+, x64 and ARM64. SDK and dependency versions live in global.json and the project files. Follow windows/AGENTS.md.
Core owns API calls, durable pending operations, timing messages and account/company-scoped recent work. Windows owns native UI and Credential Locker.
Read /openapi/public before changing requests. Persist the exact start UUID or stop timer ID before sending. Retry only that saved identity, with the original account and company. Never start a replacement timer after an ambiguous request.
Project and activity are optional. Activity requires a project. ReAI owns timing and accounting: stop saves whole minutes immediately, under one minute saves nothing, maximum ten hours, Oslo day boundaries. Poll status every thirty seconds; this is not a save interval.
Never put tokens in local history or logs. Public Windows releases are unsigned portable ZIPs by owner request; follow windows/AGENTS.md.
Build both architectures in Windows CI and check native startup. Keep temporary verification code outside the repository.
