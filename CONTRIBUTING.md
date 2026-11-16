# Contributing to BeeLadybug

Thank you for wanting to help! Every contribution is welcome: bug reports, ideas, docs fixes and code. If you are new to open source, you are in the right place.

## The one rule

BeeLadybug is **vanilla JavaScript with zero dependencies**. Please do not add any package to `dependencies`, and do not import third-party libraries in `src/`. If you think a feature needs one, open an issue first and we will find another way together.

The Core stays blind: it only receives raw packets through `sendData(type, payload)`. Anything that knows about the page (Canvas, DOM, CSS, Python) belongs in an adapter.

## Report a bug or share an idea

1. Search the [issues](https://github.com/antonioprosperi2-svg/BeeLadybug-universal/issues) to see if it is already there.
2. If not, open a new issue.
3. For a bug, tell us what you did, what you expected and what happened. Your browser and the BeeLadybug version help a lot.

## Send a pull request

1. Fork the repository.
2. Create a branch from `main` with a short name, for example `fix-css-overlay`.
3. Make your change. Keep it small and focused: one idea per pull request.
4. Run the checks and make sure they all pass:

   ```
   npm install
   npm test
   npm run lint
   npm run typecheck
   ```

   (`npm install` only adds the development tools for lint and type checks. The library itself has no dependencies.)
5. Add or update a test when you change behavior, and add a short line to `CHANGELOG.md`.
6. Open a pull request with a clear description: what changed and why, and how you tested it.

## Not sure where to start?

Open an issue and say hello. Small questions are welcome, and nobody will judge a first contribution.

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
