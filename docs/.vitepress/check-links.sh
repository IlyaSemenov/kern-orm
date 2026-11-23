#!/bin/sh
# Checks the links of the built docs site, including its sidebar, nav, and anchors, of the READMEs, and of the project documentation, without network access.
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
# The remaps resolve the links under the base of the site and the links to the published site to the built pages.
check() {
  lychee \
    --offline \
    --no-progress \
    --include-fragments=anchor-only \
    --fallback-extensions html \
    --root-dir "$dist" \
    --remap "^$dist_pattern/kern-orm([/?#].*)?\$ $dist_replacement\$1" \
    --remap "^https://ilyasemenov\.github\.io/kern-orm([/?#].*)?\$ $dist_replacement\$1" \
    "$@"
}

status=0
# A directory of the site resolves through its index.html, and a package directory, such as packages/db, through its README.md.
check --index-files index.html,README.md "$dist" README.md packages/*/README.md || status=$?
# The project documentation also links directories of the repository without an index file, such as benchmarks/types.
# This also accepts a link to a directory of the site without an index page.
check --index-files index.html,README.md,. AGENTS.md architecture backlog benchmarks comparison decisions development || status=$?
exit $status
