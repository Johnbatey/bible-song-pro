# How To Use Bible Song Pro

Current release: `Version 1.0`

## 1. Add The Plugin To OBS

1. Extract the plugin files to a permanent folder.
2. Open OBS.
3. Go to `Docks > Custom Browser Docks`.
4. Create a dock named `Bible Song Pro`.
5. Point it to `Bible Song Pro panel.html`.

## 2. Open The Display Page

Use `BSP_display.html` as the matching display/browser source in your OBS scene.

## 3. Main Workflow

### Songs

1. Open the `Songs` tab.
2. Load, create, or search for lyrics.
3. Choose the desired line split and mode.
4. Send the item live.

### Bible

Bible Song Pro ships with four versions — KJV, NKJV, NLT and NASB. They install
themselves the first time you open the panel (in the OBS dock as well as the desktop
app), so the `Bible` tab is ready to use straight away.

1. Open the `Bible` tab.
2. Choose a Bible version.
3. Search for a reference or browse book/chapter.
4. Adjust grouping, display mode, and styling as needed.
5. Send the selection live.

To add another version, either use `Import` in the panel (any XML Bible), or drop the
XML file into `bibles/source/` and run `npm run bibles:build` — it will then load
automatically for everyone using that folder.

If you delete one of the bundled versions, it stays deleted; it will not come back on
the next launch.

### Setlist

1. Build your setlist from songs and Bible items.
2. Reorder as needed.
3. Project items directly from the setlist.

## 4. Settings

Use `Settings` to configure:

- Full Screen mode
- Lower Third mode
- Typography and colors
- Backgrounds
- Song options
- Bible options
- Plugin layout
- Themes

## 5. Notes

- The plugin is designed for OBS dock use.
- Keep the display file and panel file together in the same folder.
- Keep the `bibles` folder next to `Bible Song Pro panel.html`. That is where the bundled
  Bible versions are loaded from; if it is missing, the panel still runs but starts with
  no Bible versions.
- If you move the files, update the path in OBS.
- Some browser security settings in OBS may affect local file access depending on your setup.

## 6. Recommended Release Layout

For GitHub releases, provide:

- the source files in the repo
- the end-user zip package
- this usage guide
- the license and copyright files

## 7. Support The Project

This plugin is provided free to help churches reach a wider audience with the message of the Gospel.

Donations are appreciated to support continued development and maintenance.

- Instagram: `https://www.instagram.com/johnsonolakotan`
