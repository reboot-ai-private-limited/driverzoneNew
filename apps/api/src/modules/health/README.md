# `health` — reference module

The smallest complete example of the architecture every other module follows. Copy this
shape when adding a module; see `docs/engineering/11-adding-a-module.md`.

```
health/
├── health.public.ts        the ONLY file other modules may import  (tier 0)
├── health.container.ts     the ONLY file naming concrete classes
├── domain/
│   ├── health.entity.ts    what a health report IS + the one rule (degraded vs healthy)
│   └── healthProbe.port.ts what the domain NEEDS, without naming a provider
├── application/useCases/
│   └── getHealth.usecase.ts   orchestration; typed against the port
├── infrastructure/
│   ├── mongoHealthProbe.adapter.ts   the only files that know Mongoose/ioredis exist
│   └── redisHealthProbe.adapter.ts
└── interface/
    ├── health.controller.ts   HTTP in, use case out
    └── health.routes.ts
```

The dependency arrow points **inward** at every step: `interface → application → domain`, and
`infrastructure → domain`. Nothing in `domain/` imports from any layer above it, which is what
makes `GetHealthUseCase` testable with two three-line fakes and no running database — see
`test/health.test.ts`.
