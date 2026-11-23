#!/bin/sh
# Checks the links of the built docs site, including its sidebar, nav, and anchors, and the links of the READMEs to it.
set -e
cd "$(dirname "$0")/../.."

dist="$PWD/docs/.vitepress/dist"
# lychee splits a remap at whitespace, so the file URLs of the remaps encode spaces.
dist_url="file://$(printf '%s' "$dist" | sed 's/ /%20/g')"
# The patterns of the remaps match the URL literally.
dist_pattern="$(printf '%s' "$dist_url" | sed 's/[][\\.*^$+?(){}|]/\\&/g')"
# The replacements of the remaps keep a literal `$` as `$$`.
dist_replacement="$(printf '%s' "$dist_url" | sed 's/\$/$$/g')"

# --fallback-extensions resolves clean URLs, such as /orm/schemas, to their pages.
# With lychee 0.24, both /orm/schemas.md and /orm/schemas/ pass when orm/schemas.html exists.
# --index-files resolves the links of the READMEs to directories of the repository, such as packages/db.
# The remaps resolve the links under the base of the site and the links of the READMEs to the published site to the built pages.
exec lychee \
  --offline \
  --no-progress \
  --include-fragments=anchor-only \
  --fallback-extensions html \
  --index-files index.html,README.md \
  --root-dir "$dist" \
  --remap "^$dist_pattern/kern-orm([/?#].*)?\$ $dist_replacement\$1" \
  --remap "^https://ilyasemenov\.github\.io/kern-orm([/?#].*)?\$ $dist_replacement\$1" \
  "$dist" README.md packages/*/README.md
