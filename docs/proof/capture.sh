#!/usr/bin/env bash
# docs/proof/capture.sh — run a command and render its terminal output as a PNG.
#
#   docs/proof/capture.sh "npx vitest run src/weave" docs/proof/tests.png
#
# Every image under docs/proof/ was produced by this script, so the styling is
# uniform and any of them can be regenerated from a clean checkout. The command
# runs through `sh -c` (pipes allowed), with colour forced and CI=1 so tools pick
# their non-interactive reporters. Rendering is charmbracelet/freeze.
#
#   docs/proof/capture.sh -f transcript.txt docs/proof/out.png
#
# renders a transcript that was already captured (same styling, no re-run).
set -u
if [ "$1" = "-f" ]; then
  tmp="$2"; out="$3"; keep=1
else
  cmd="$1"; out="$2"; tmp="$(mktemp)"; keep=0
  {
    printf '\033[1;35m❯\033[0m \033[1m%s\033[0m\n\n' "$cmd"
    FORCE_COLOR=1 sh -c "$cmd" 2>&1
  } > "$tmp"
fi
# </dev/null: freeze waits on stdin when it is an open pipe (it accepts code on
# stdin), which hangs the script under CI runners and agent shells.
freeze "$tmp" -l ansi -o "$out" </dev/null \
  --theme catppuccin-mocha --window --show-line-numbers \
  --font.family "JetBrains Mono" --font.size 14 --line-height 1.45 \
  --padding 28,36,28,24 --margin 40 \
  --border.radius 12 --border.width 1 --border.color "#313244" \
  --shadow.blur 30 --shadow.x 0 --shadow.y 16
status=$?; [ "$keep" = 1 ] || rm -f "$tmp"; exit $status
