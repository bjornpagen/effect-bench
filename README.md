# effect-bench

How fast does idiomatic Effect 4 run when the engine underneath changes? effect-bench runs real code from real
codebases (grizzle's compiler, qti-pie, effect-xml, effect-openapi-cli-generator and the applications they serve)
on Node with each of V8's tiers, on LLRT (QuickJS-ng, no JIT), on Bun, and as a Bun ahead-of-time executable, and
checks that every engine computes the same answer.

[AGENTS.md](AGENTS.md) is the working contract for anyone, human or agent, changing the code.

```sh
pnpm install   # also patches TypeScript with @effect/tsgo and installs the git hooks
pnpm check     # the gate: typecheck, superlint, oxlint, fixtures, format, dedupe, fallow
pnpm test      # every property suite, with fresh seeds
```

## License

0BSD. See [LICENSE](LICENSE).
