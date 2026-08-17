# Contributing

1. Open an issue describing the contract gap and a safe public reproducer.
2. Keep probes read-only, deterministic, and argument-array based.
3. Add one known-good and one known-bad fixture for new result semantics.
4. Run `npm run test:release` before submitting a pull request.

Do not add credential collection, real-account migration, automatic repair, arbitrary shell commands, or production mutations.
