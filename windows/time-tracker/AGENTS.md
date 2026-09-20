# Windows Time Tracker

Native WinUI 3 app on .NET 11 RC1 / C# 15, Windows 11 25H2+, x64 and ARM64. The user explicitly selected .NET 11. Follow windows/AGENTS.md.
Core owns API calls, durable pending operations, timing messages and account/company-scoped recent work. Windows owns native UI and Credential Locker.
Read /openapi/public before changing requests. Persist the exact start UUID or stop timer ID before sending. Retry only that saved identity, with the original account and company. Never start a replacement timer after an ambiguous request.
Project and activity are optional. Activity requires a project. ReAI owns timing and accounting: stop saves whole minutes immediately, under one minute saves nothing, maximum ten hours, Oslo day boundaries. Poll status every thirty seconds; this is not a save interval.
Never put tokens in local history or logs. Public downloads require trusted Windows signing.
Build both architectures in Windows CI and check native startup. Keep temporary verification code outside the repository.
