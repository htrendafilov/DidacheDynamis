#!/bin/zsh
set -euo pipefail

script_directory="${0:A:h}"
package="${script_directory}/BaptistConfession1689BG.swd"
target="${HOME}/Library/Application Support/Sword"

if [[ ! -f "${package}" ]]; then
  echo "Липсва пакетът: ${package}"
  echo "Постави този инсталатор до BaptistConfession1689BG.swd и опитай отново."
  read -r "?Натисни Enter за край..."
  exit 1
fi

mkdir -p "${target}"
ditto -x -k "${package}" "${target}"

echo
echo "Българската Баптистка изповед от 1689 г. е инсталирана в:"
echo "${target}"
echo
echo "Ако Eloquent е отворен, затвори го напълно и го стартирай отново."
read -r "?Натисни Enter за край..."
