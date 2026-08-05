# LICENSES

Full texts of the licenses that apply to content this project distributes. The code and
original documentation are MIT-licensed — that text lives in the repository root
[`LICENSE`](../LICENSE), not here.

**Start with [`NOTICE`](../NOTICE).** It is the authoritative record of which work carries
which terms, who holds the rights, what attribution is required, and what was modified.
This directory only holds the verbatim license texts that `NOTICE` refers to.

| File | License | Applies to |
|---|---|---|
| [`CC-BY-4.0.txt`](CC-BY-4.0.txt) | Creative Commons Attribution 4.0 International | TSK cross-reference data (`tsk`) |
| [`CC0-1.0.txt`](CC0-1.0.txt) | CC0 1.0 Universal public-domain dedication | Bulgarian 1689 Confession translation (`baptist1689bg`); project logo |
| [`GPL-2.0.txt`](GPL-2.0.txt) | GNU General Public License, version 2 | Included for the CrossWire KJV module's `DistributionLicense: GPL` field — see below |

Both texts were retrieved verbatim from the canonical Creative Commons URLs:

- `https://creativecommons.org/licenses/by/4.0/legalcode.txt`
- `https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt`

## Works with no license text here

Most imported works are **public domain** — the World English Bible, Matthew Henry's
Commentary, Easton's Bible Dictionary, both English editions of the 1689 Confession, and
Strong's Greek and Hebrew dictionaries. A public-domain dedication has no license text to
reproduce; `NOTICE` records each work's rights basis, source module, and required
attribution instead.

Two of those still carry obligations that are not license conditions, and `NOTICE` states
them in full:

- the **World English Bible** text is public domain, but "World English Bible" is a
  trademark of eBible.org, so the name cannot be used to label a modified text;
- **CC BY 4.0** requires attribution, a link to the license, and an indication of changes
  to travel with the TSK data — including when it travels inside `content.sqlite` or the
  container image rather than as a file.

## King James Version

The KJV is not committed to this repository; the build fetches it from CrossWire's official
module and compiles it into `content.sqlite`, which ships in the container image and on the
live site. CrossWire grants a general public license to use the KJV2003 Project text **for any
purpose**, and that grant — from the holder of whatever copyright exists in the effort — is the
operative permission. The module separately records a `DistributionLicense: GPL` field, read as
describing the SWORD module package rather than the text, and Crown of England rights in the
base text, which are territorial to the United Kingdom.

`GPL-2.0.txt` is included anyway, as belt and braces: if the label is read as covering the text,
the obligations it imposes are attribution, the licence text, and corresponding source — all of
which this project provides (`NOTICE` §3, this file, and the checksum-pinned
`scripts/fetch-kjv.sh`). The module records `GPL` with no version; SWORD itself is GPL-2.0.

The reasoning and the rejected alternative are recorded in `plan/going_public.md` decision 11.
