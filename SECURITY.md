# Security policy

## Supported versions

| Version | Security updates |
| --- | --- |
| 1.x | Yes |
| 0.0.x | No |

Only the latest `1.x` release receives security fixes. Users should also keep
their operating-system FUSE 2 or macFUSE runtime current.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Report it privately
through the repository's
[GitHub Security Advisory form](https://github.com/mmdevries/fuse-napi/security/advisories/new).

Include, where possible:

- affected `fuse-napi`, Node.js, operating-system, and FUSE runtime versions;
- architecture and installation method;
- a minimal reproducer or crash trace;
- the expected impact and whether untrusted filesystem input is required; and
- any suggested mitigation.

Reports should receive an acknowledgement within three business days and an
initial assessment within seven business days. Timelines for a coordinated
fix and disclosure depend on severity and whether upstream FUSE components are
involved.

## Security boundaries

`fuse-napi` validates the JavaScript/native boundary but does not sandbox a
filesystem implementation. Applications remain responsible for authorization,
path policy, data validation, secrets, and safe use of options such as
`allowOther`, `allowRoot`, and `defaultPermissions`.

The package dynamically links the host's FUSE 2 runtime. Vulnerabilities in
libfuse, macFUSE, the kernel extension, or the operating system should also be
reported to their respective maintainers.
