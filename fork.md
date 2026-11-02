# Leynier's CCS Variant

This repository tracks [upstream CCS](https://github.com/kaitranntt/ccs). Only the always-on Docker server runs this variant; the Linux global CLI and the macOS/Windows installations remain upstream installations. There is no npm publishing, registry publishing, scheduled sync, or upstream PR automation for this variant.

## Agreed Context

The server previously installed upstream CCS 8.10.0 on top of a published integrated image. The goal is a personal variant that can evolve while continuing to contribute upstream, without replacing the global CLI or client installations. `next` began with the same-email organization-account fix from upstream PR [#1783](https://github.com/kaitranntt/ccs/pull/1783), then merged upstream `dev`. That PR branch has its own review lifecycle and must not receive variant commits. CLIProxyAPI is built from its own fork so proxy changes can also be developed independently.

The service remains private over NetBird: dashboard port 3000, API host port 9317 mapped to container port 8317. Existing clients use their separate `~/ccs-remote/settings.json` through T3 Config Directory. No client reconfiguration is needed when the server image changes.

## Branches and Contributions

- `main` mirrors `upstream/main`, fast-forward only.
- `dev` mirrors `upstream/dev`, fast-forward only.
- `next` carries personal integrations and merges `upstream/dev`; never rebase or force-push it.
- `feat/*` and `fix/*` intended for upstream start from `upstream/dev`. Open upstream PRs only from those branches, targeting `dev`. Keep fork identity, submodule, and deployment changes on `next`.

`vendor/CLIProxyAPI` is a pinned submodule of [leynier/CLIProxyAPI](https://github.com/leynier/CLIProxyAPI). Its `main` mirrors `router-for-me/CLIProxyAPI` `main`; its `next` contains personal integrations. A branch tracking setting helps manual updates; the committed gitlink, not a moving branch, determines each server build.

## Manual Upstream Sync

Run from the `next` worktree. If a mirror branch is checked out elsewhere, update it there with `merge --ff-only`; never switch the main checkout or rewrite a divergent mirror. These commands verify ancestry before advancing mirrors and never force a push.

```bash
git fetch upstream --no-tags
git fetch origin --no-tags
git merge-base --is-ancestor origin/main upstream/main
git merge-base --is-ancestor origin/dev upstream/dev
git push origin upstream/main:main upstream/dev:dev
git merge --no-edit upstream/dev
git submodule update --init --recursive
git push -u origin next
```

Create an independent worktree for an upstream contribution:

```bash
git fetch upstream --no-tags
git worktree add -b feat/example ../ccs-example upstream/dev
# Implement, validate, commit, then push only the topic branch.
git -C ../ccs-example push -u origin feat/example
# Open an upstream PR manually after approval. Target kaitranntt/ccs:dev.
```

The local-binary feature is maintained on `feat/local-cliproxy-binary` and merged into `next`. Before proposing it upstream, coordinate its matching public documentation change in `kaitranntt/ccs-docs`; no upstream PR is opened by this setup.

## Claude Account Labels and Quotas

`next` also integrates the independent upstream contributions [saved account nicknames (#1793)](https://github.com/kaitranntt/ccs/pull/1793) and [optional scoped Claude quotas (#1794)](https://github.com/kaitranntt/ccs/pull/1794). Nicknames are display labels; account IDs, token associations and persisted names do not migrate. Privacy mode masks nicknames while retaining account disambiguation.

Compact monitor nicknames wrap independently of controls and badges, with workspace hashes kept secondary. General 5-hour, general weekly and model-specific weekly windows are independently optional. Modern `session`/`weekly_all` aliases are canonicalized against legacy windows; dollar-denominated credit grants are excluded from time-quota bars. Normalization version 4 invalidates only old normalized results and preserves cooldown state. Only general account windows determine CCS account health, rotation and automatic pause. Model-only results retain their visible rows with unknown general capacity; CLIProxyAPI continues handling model-specific request rejections. The [quota contract](./docs/claude-scoped-quotas.md) describes normalization, nullable resets, explicit units and cooldown-preserving cache upgrades. These changes require no credential, account or volume deletion.

## Claude Pool Priority

The opt-in [Claude quota policy (#1796)](https://github.com/kaitranntt/ccs/pull/1796) and [proxy priority/affinity support (#7195)](https://github.com/router-for-me/CLIProxyAPI/pull/7195) prefer five-hour-only accounts, then five-hour plus general weekly, then general-weekly-only, then unknown. Fable and all other model-specific windows are excluded. The quota contract preserves present, absent and unknown general windows independently of numeric usage; failed or stale queries retain the last reliable class for no more than six hours from the original observation.

The persistent Docker bootstrap and dashboard server share one reconciler, initially and every 60 seconds, even with the browser closed. Claude uses round-robin for new conversations in the highest eligible group and keeps affinity inside that group; a recovered higher group can take the next request. Explicit pins and proxy model eligibility, cooldown and retries remain authoritative. Other providers keep their existing policy. Reviewed proxy corrections freeze the requested provider set before availability or retry filtering, so a heterogeneous pool retains its global policy. Priority CAS rejects skipped saves and pending Codex refresh patches, and cannot re-register a credential removed after its commit.

Use `ccs cliproxy accounts order claude --by-quota` or the dashboard routing control to enable, inspect the same command without flags, and use `--no-quota` to restore preceding priorities. The proxy must advertise provider overrides, atomic priority updates and the built-in local selector. A private ownership journal preserves missing, zero and negative priorities and reports external edits rather than overwriting them. A manual order replaces automatic ownership. See the [policy contract](./docs/claude-pool-priority.md) and the proxy [configuration contract](./vendor/CLIProxyAPI/docs/session-affinity-priority.md).

Before switching back to an image without this feature, disable the policy and complete owned-priority restoration with the capable image. If its API is unavailable, use a reviewed offline metadata-only recovery with all writers stopped; retain the journal and newest OAuth state. An image rollback alone does not restore the previous routing mode or priority metadata.

## Update the Proxy Submodule

Use a separate worktree for proxy code changes; do not edit the main CLIProxyAPI checkout or the submodule's mirror branch.

```bash
git -C /home/leynier/Projects/personal/CLIProxyAPI fetch upstream --no-tags
git -C /home/leynier/Projects/personal/CLIProxyAPI fetch origin --no-tags
git -C /home/leynier/Projects/personal/CLIProxyAPI merge-base --is-ancestor origin/main upstream/main
git -C /home/leynier/Projects/personal/CLIProxyAPI push origin upstream/main:main
# Create/use an isolated CLIProxyAPI next worktree, merge upstream/main, validate, and push next.
git -C vendor/CLIProxyAPI fetch origin next
git -C vendor/CLIProxyAPI checkout --detach origin/next
git add vendor/CLIProxyAPI
git commit -m "chore(proxy): update pinned submodule"
```

## Build and Stage

`getVersion()` adds `+leynier` to the upstream version without changing release versions or tags. Source-managed builds suppress CCS update checks and refuse npm replacement, including `ccs update --force` and `--beta`. To update, sync source and rebuild. The Dockerfile compiles the submodule and uses `CCS_CLIPROXY_BINARY=/usr/local/bin/CLIProxyAPI`; managed download, pinning and auto-update do not own this binary. `CCS_CLIPROXY_BINARY_VERSION` carries the matching build version for status and compatibility gates; an arbitrary local binary without this assertion conservatively reports an unknown version.

Build from a clean, committed `next` worktree with its submodule initialized. Heavy commands run sequentially under an 8 GiB limit and 15-minute timeout. Because Docker builds execute in a daemon, also use a dedicated memory-limited builder:

```bash
docker buildx create --name ccs-variant-builder --driver docker-container --driver-opt memory=8g,memory-swap=8g
# Reuse that builder on subsequent builds; do not create it again.
ccs_revision=$(git rev-parse HEAD)
proxy_revision=$(git rev-parse HEAD:vendor/CLIProxyAPI)
git -C vendor/CLIProxyAPI fetch --tags https://github.com/router-for-me/CLIProxyAPI
proxy_base=$(git -C vendor/CLIProxyAPI describe --tags --abbrev=0 | sed 's/^v//')
proxy_version="$proxy_base+leynier.$(git -C vendor/CLIProxyAPI rev-parse --short HEAD)"
flock /tmp/ccs-variant-heavy.lock systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 900 \
  docker buildx build --builder ccs-variant-builder --load \
  -f docker/Dockerfile.leynier \
  --build-arg CCS_COMMIT="$ccs_revision" --build-arg CLIPROXY_COMMIT="$proxy_revision" \
  --build-arg CLIPROXY_VERSION="$proxy_version" \
  -t "ccs-remote:leynier-$ccs_revision" .
docker buildx stop ccs-variant-builder
```

Before switching, copy the current `ccs_home` volume directly into a dedicated test volume without printing any file contents. Run the candidate on loopback-only spare ports (for example panel 13000 and API 19317) with that copy and a separate logs volume. Verify panel authentication, authenticated Opus responses, pool configuration, the actual proxy process executable, and embedded proxy commit. Never mount the production volume writable into both running images. Test volumes can contain credentials: retain them privately until deletion is approved.

## Deploy and Roll Back

The private [ccs-service repository](https://github.com/leynier/ccs-service) owns deployment configuration on `main` at `~/Projects/personal/ccs-service`. `~/Services/ccs` remains its compatibility symlink. Its `ccs` submodule pins this fork, while `compose.yaml` records the matching CCS commit, proxy commit/version and image tag. Application changes are integrated here first, then selected through a service gitlink update; a source push does not deploy.

Follow service [case 11](https://github.com/leynier/ccs-service/blob/main/docs/workflows/11-deploy-pinned-variant.md) for staging and an authorized switch, and [case 12](https://github.com/leynier/ccs-service/blob/main/docs/workflows/12-rollback-deployment.md) for recovery. Keep project/service names, existing volumes, mount paths and NetBird bindings unchanged. The home `ccs-repair` target delegates to the service repository's `make repair`, which owns the systemd restart and endpoint checks.

Retain the actual currently deployed immutable image and configuration before switching. Test offline first; copied OAuth credentials must have only one network-connected writer during live verification. Stop both instances before promoting the candidate's latest OAuth state. Rollback uses the retained image and a forward recovery commit while preserving refreshed credentials; never restore old authentication over newer state. Historical 8.10.0 images and migration scripts are not current rollback assets.

Do not delete branches, images, volumes or backups without approval. Keep upstream PR #1783's branch untouched. Pool configuration checks do not prove real quota-triggered account rotation; observe that naturally rather than exhausting credentials.
