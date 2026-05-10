---
title: IntelliJ IDEA 13 SBT support
date: 2014-07-15
summary: When IntelliJ 13's SBT support gets confused about multi-project setups, here's the one-liner that gets it back to a clean state.
tags: [intellij, scala, sbt]
---

I was toying around with a multi project SBT file and the new IntelliJ 13 SBT support. It turns out that it has a lot of trouble with multi project setups. When adding projects and renaming them IntelliJ gets really confused and you end up with projects having the wrong name and some residual artifact projects in your project. I managed to get things to work again by closing IntelliJ and running the following in my project root:

```bash
find . -name ".idea" -type d -exec rm -r {} +
```
