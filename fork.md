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

The host service lives in `~/Services/ccs`; systemd `ccs-remote.service` waits for NetBird, starts Compose with `--no-build --force-recreate`, and probes both endpoints. Keep the Compose project `ccs-remote`, service `ccs`, volume names, mount paths, and NetBird bindings unchanged. Preserve the existing `ccs-remote:8.10.0` image for rollback.

1. Back up `compose.yaml` and `Dockerfile` to a timestamped private directory. Record the tested source/proxy commits and immutable image ID in a deployment receipt. Copy credential/config data only between the existing volume and a backup/test volume.
2. Set Compose's image to the tested commit-specific tag. Point its build context and Dockerfile to the pinned source checkout with both commit arguments and the proxy version argument, so an explicit later build cannot restore upstream npm code.
3. Recreate only the CCS service with `docker compose up -d --no-build --force-recreate --wait --wait-timeout 120`. This is the brief switch; do not run `down -v`.
4. Verify authenticated API responses, panel authentication, pool settings, systemd state, and access from Linux/macOS/Windows. `make -C ~ ccs-repair` uses sudo to restart the existing systemd unit and recheck both public endpoints.
5. To roll back, restore the saved Compose file, then run the same `docker compose up -d --no-build --force-recreate --wait --wait-timeout 120`. It uses the retained `ccs-remote:8.10.0` image and persistent home/log volumes. If runtime migration changed stored configuration incompatibly, stop CCS before restoring the saved home volume; never overwrite credentials refreshed since the backup without reviewing them privately.

Do not delete branches, images or volumes without approval. Keep upstream PR #1783's branch untouched. Pool configuration checks do not prove real quota-triggered account rotation; observe that naturally rather than exhausting credentials.
