# data/sources

Committed source texts used by `apps/importer` to build `content.sqlite`. **Only public-domain /
redistributable sources belong here** (owner-provided/licensed texts stay out of git).

| File | Work | License | Source |
|---|---|---|---|
| `engwebp_usfx.zip` | World English Bible (Protestant) | Public domain | https://ebible.org/find/details.php?id=engwebp |

**World English Bible attribution (required):** "The World English Bible is in the Public Domain. That
means that it is not copyrighted. However, 'World English Bible' is a Trademark of eBible.org."

Rebuild the database from these sources:

```
bibleimport build-web --source data/sources/engwebp_usfx.zip --out data/content.sqlite
```
