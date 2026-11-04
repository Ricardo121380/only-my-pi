# Frontend notice supplement

The locked `react-remove-scroll-bar@2.3.8` npm package declares `MIT` in its
manifest but omits the license file from its published files. Its npm `gitHead`
could not be resolved in the public upstream repository at verification time.

`react-remove-scroll-bar-LICENSE.txt` is the unmodified upstream license from
[commit 8ca9ba5ea52de03308fe8ced94f7b159a44d28ff](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE).
That source tree declares version 2.3.7; this is a documented upstream notice
supplement, not an assertion that the 2.3.8 tarball contained this file.

The B2 build uses this supplement only for the exact package name/version when
the installed manifest still declares `MIT`. It embeds the full notice and
its source URL. Every other bundled package must supply its own license file.
