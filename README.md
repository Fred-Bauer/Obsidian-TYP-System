# TYP-System

Notiz-Typ-System für diesen Vault: eine eigene, links andockende **TYP-Pane** (Befehl „TYP-View öffnen“), ein nativer **TYP-Picker**, Standard-Frontmatter je Typ, Frontmatter-Sortierung sowie Einfärbung der Notiznamen nach ihrem `TYP`-Frontmatter in mehreren Ansichten. Ehemals Teil des Plugins **Fred**, seit der Aufteilung in ein eigenes Plugin ausgelagert.

## TYP-Pane

- Listet alle definierten Typen, sortiert nach Anzahl zugehöriger Notizen, Name, oder Farbe (umschaltbar über den Sortier-Button im Header)
- Typen, die zwar in Notizen vorkommen aber noch nicht erfasst sind, erscheinen blass unterhalb einer Trennlinie
- `[KEIN TYP]` zeigt die Anzahl Notizen ganz ohne `TYP`-Property
- **Registrierter Typ:** Linksklick öffnet die Detailansicht, Rechtsklick öffnet die Suche (`["TYP":"…"]`)
- **Unregistrierter Typ:** Linksklick übernimmt ihn in die Liste – dabei automatisch bereinigt (getrimmt, Großbuchstaben), und der TYP-Wert aller betroffenen Notizen gleich mit umgeschrieben, damit sie nicht weiterhin als „nicht registriert“ auftauchen. Rechtsklick öffnet die Suche
- **TYP ist immer genau ein sauberer Wert.** Unsaubere Werte werden in Rohform als eigener unregistrierter Eintrag gelistet, statt stillschweigend einem registrierten Typ zugeschlagen zu werden – sie bekommen auch keine Farbe:
  - Randleerzeichen erscheinen in Anführungszeichen (`" BUCH"`), Klick → `BUCH`
  - Listen erscheinen mit Klammern (`[PERSON, BUCH]`), Klick → neuer Typ `PERSON, BUCH` als Einzelwert; per Umbenennen lässt er sich danach in einen bestehenden Typ überführen (s. „Zusammenlegen“)
- **`[KEIN TYP]`:** Links- und Rechtsklick öffnen beide die Suche
- Rechtsklick auf freie Fläche bzw. „+“-Button im Header: **Neuen Typ hinzufügen** – neuer Eintrag wird sofort inline umbenannt (kein Modal, kein Eingabefeld – nutzt denselben Mechanismus wie Obsidians eigene Umbenennungen), Name wird automatisch in Großbuchstaben normalisiert
- Jeder Typ hat einen anklickbaren Farbpunkt (nativer Farbwähler)
- Zähler bleiben automatisch aktuell (lauscht auf Notiz-Änderungen/-Löschungen sowie auf Änderungen an Obsidians "Excluded files"-Liste, z. B. durch Hide Folders), nicht nur beim manuellen Neuladen der View

## TYP-Detailansicht

Per Klick auf einen registrierten Typ:

- **Zwei Umbenennen-Buttons** nebeneinander: der normale (Bleistift) ändert nur die Plugin-Einstellungen (Farbe, Beschreibung, Standard-Frontmatter etc.); der davor hervorgehobene (Akzentfarbe, ebenfalls Bleistift) schreibt zusätzlich den TYP-Wert **aller betroffenen Notizen** um – vor dem Speichern erscheint dafür ein Bestätigungs-Modal mit der Anzahl betroffener Notizen
- **Zusammenlegen:** Umbenennen auf den Namen eines bereits registrierten Typs (egal über welchen der beiden Buttons) fragt, ob beide zusammengelegt werden sollen. Dabei werden die Notizen auf den Zieltyp umgeschrieben; Farbe, Beschreibung und Standard-Frontmatter des Quelltyps entfallen, seine SUBTYPen (samt Beschreibungen, sofern das Ziel keine eigene hat) werden übernommen
- **Löschen**-Button mit Bestätigungs-Modal
- In beiden Bestätigungs-Modalen wird der TYP-Name je nach Einstellung *TYP View einfärben* farbig oder mit vorangestelltem Farbpunkt dargestellt
- Notiz-Anzahl direkt neben dem Namen (muted)
- **„Manueller TYP“-Schalter** (standardmäßig an): steuert, ob dieser Typ im TYP-Picker (s. u.) standardmäßig zur Auswahl steht. Aus für Typen mit eigenem Erstellungsweg, die nicht manuell vergeben werden sollen (z. B. `KONTAKT`, `EXTERN`)
- Farbe (nativer Farbwähler mit Reset-Button) und frei editierbare Beschreibung
- **Standard-Frontmatter:** Obsidians natives Property-Widget – Properties, die neue Notizen dieses Typs automatisch bekommen (leer als auszufüllender Platzhalter, oder mit festem Wert)
- **Floating Properties:** kein eigener Abschnitt, sondern einzelne, kursiv dargestellte Zeilen innerhalb derselben Liste (per Drag & Drop an beliebiger Stelle einsortierbar) – über den zusätzlichen, hervorgehobenen „+“-Button links neben dem normalen hinzugefügt. Zählen genauso für die Frontmatter-Sortierung mit, werden aber NICHT automatisch bei neuen Notizen angelegt. Für Properties, die zu einem Typ gehören und an derselben Stelle einsortiert werden sollen wie die übrigen, aber nur bei Bedarf in einzelnen Notizen auftauchen. Templater bekommt sie nur, wenn `getTypeDefaults()` explizit mit `includeFloating: true` aufgerufen wird
- **Platzhalter** im Standard-Frontmatter bzw. bei Floating Properties (Legende direkt darunter):
  - `{{today}}` – heutiges Datum (JJJJ-MM-TT)
  - `{{now}}` – aktuelles Datum mit Uhrzeit (JJJJ-MM-TT HH:mm)
  - `{{created}}` – Erstellungsdatum der Datei (JJJJ-MM-TT), nicht der Aufrufzeitpunkt
  - `{{tp.<Skriptname>}}` – ruft beim Anlegen einer Notiz dynamisch das gleichnamige Templater-Skript (`tp.user.<Skriptname>`) auf und übernimmt dessen Rückgabewert (siehe *Templater-Integration*)

  Erkannte Platzhalter werden farblich hervorgehoben, Obsidians „Type mismatch“-Warnung wird für sie unterdrückt.

## TYP-Picker

Nativer Ersatz für Templaters eigenen `tp.system.suggester` bei der Typ-Auswahl (baut auf Obsidians `FuzzySuggestModal` auf):

- Zeigt Typ-Farbe bzw. Farbpunkt (je nach Einfärbungs-Einstellung), Beschreibung (muted) und Notiz-Anzahl je Zeile
- Blendet standardmäßig Typen mit deaktiviertem „Manueller TYP“-Schalter aus (per Parameter einschließbar)
- Kann optional auch unregistrierte Typen mit auflisten
- Wird sowohl von den eigenen Befehlen dieses Plugins als auch von Templater-Skripten genutzt (siehe *Templater-Integration*)

## Frontmatter-Sortierung

Bringt die in einer Notiz vorhandenen Properties in eine feste Reihenfolge (ergänzt oder ändert keine Werte):

- Editierbare **globale Reihenfolge** (Einstellungen → TYP-System, per Drag & Drop) aus frei platzierbaren Einzel-Properties (z. B. `cssclasses`, `aliases`, keine Dopplungen möglich) sowie drei nicht entfernbaren Platzhaltern: die `TYP`-Property selbst, die Standard-Frontmatter-Liste des jeweiligen Typs („TYP Properties“, inkl. dessen Floating Properties an ihrer jeweiligen Position innerhalb dieser Liste), und „Sonstige Properties“ für den Rest. Eine fest platzierte Einzel-Property hat dabei immer Vorrang vor ihrem Vorkommen in der Standardliste eines Typs, unabhängig davon, wo „TYP Properties“ in der Liste steht
- Play-Button neben der Überschrift wendet die aktuelle Reihenfolge sofort auf den gesamten Vault an (identisch zum Befehl „Frontmatter Sortierung GLOBAL aktualisieren“)
- Befehl **„Frontmatter Sortierung GLOBAL aktualisieren“** – über den ganzen Vault
- Befehl **„TYP Frontmatter Sortierung aktualisieren“** – fragt über den TYP-Picker (inkl. nicht registrierter und manuell deaktivierter Typen) einen Typ ab und sortiert nur dessen Notizen; ohne gepflegtes Standard-Frontmatter greift nur die globale Reihenfolge (mit entsprechendem Hinweis in der Rückmeldung)
- Befehl **„Frontmatter Sortierung der aktiven Notiz aktualisieren“**
- Jeder Lauf meldet per Notice geprüfte/sortierte Notizen bzw. bei einem Fehler dessen Meldung, statt lautlos nichts zu tun; ein Vorab-Check über den bereits im Speicher vorhandenen Metadata-Cache sorgt dafür, dass bereits korrekt sortierte Notizen bei wiederholten Läufen nicht extra geöffnet/geschrieben werden
- optional: Property-Namen, die im Standard-Frontmatter eines Typs stehen, in Notizen (Frontmatter-Widget und „All Properties“-Ansicht) fett markieren – als Floating Property markierte darunter stattdessen kursiv

## Ignorierte Notizen

Standardmäßig überspringen TYP-Zähler, TYP-Picker und Frontmatter-Sortierung Notizen aus Obsidians „Excluded files“-Liste (dort tragen auch Plugins wie Hide Folders ausgeblendete Ordner ein). Über **„Ignorierte Notizen IMMER berücksichtigen“** abschaltbar.

## Einfärbung nach TYP

Die vergebenen Typ-Farben werden automatisch übernommen in:

- **Datei-Explorer** (inkl. Ordnern mit Folder-Note)
- **Graph** (global und lokal) – eigene Farbgruppen im Graph haben immer Vorrang
- **Suche**
- **Recent Files** (Community-Plugin)
- **Backlinks** – sowohl das Backlinks-Pane in der Seitenleiste als auch die im Dokument eingebetteten Backlinks (inkl. nicht verlinkter Erwähnungen)
- **Bookmarks** – Einträge, die direkt auf eine Notiz zeigen (Ordner-/Such-/Gruppen-Bookmarks bleiben unverändert)
- **TYP-Pane selbst** (Liste und Detailansicht)
- **Links in Notizen** – interne Links (`[[…]]`, auch mit Alias) in der Farbe des Typs ihres Ziels, im Lese-Modus, in Live Preview/Quelltext und in der Hover-Vorschau. Nicht aufgelöste Links und Einbettungen (`![[…]]`) bleiben unverändert
- **All Properties** – Property-Namen, die im Standard-Frontmatter genau eines Typs vorkommen, in dessen Farbe (zusätzlich kursiv, falls dort als Floating Property markiert); kommen sie bei mehreren Typen vor, stattdessen fett

Jede Ansicht lässt sich einzeln ein-/ausschalten. Zusätzlich lässt sich unabhängig davon eine eigene **Tag-Farbe** sowie eine **Anhänge-Farbe** für entsprechende Knoten im Graph aktivieren.

Einstellungen: **TYP-System** → *Einfärbung* (pro Ansicht ein-/ausschalten) bzw. *Graph* (Tag-/Anhänge-Farbe).

## Templater-Integration

Das Plugin selbst enthält keine Templater-Logik, stellt aber eine kleine API auf dem Plugin-Objekt bereit (`app.plugins.plugins["typ-system"]`), die `_obsidian/templater-scripts/TYP.js` (und darauf aufbauende Templates) beim Anlegen neuer Notizen nutzt:

- `getTypes({ includeManualOff })` – Typen mit Beschreibung und Notiz-Anzahl, in der aktuellen TYP-Pane-Sortierung
- `getTypeDefaults(type, { includeFloating, file })` – aufgelöstes Standard-Frontmatter des Typs (feste Platzhalter wie `{{today}}` bereits eingesetzt); mit `includeFloating: true` zusätzlich die Floating Properties des Typs (standardmäßig ausgeklammert); `file` wird an `{{created}}` durchgereicht (Erstellungsdatum der Datei statt des Aufrufzeitpunkts) und sollte beim Anlegen einer neuen Notiz mitgegeben werden
- `pickType({ includeManualOff, includeUnregistered })` – öffnet den nativen TYP-Picker, löst mit dem gewählten Typ oder `null` auf
- `matchDynamicPlaceholder(value)` – erkennt einen `{{tp.<Skriptname>}}`-Wert und liefert den Skriptnamen (die Auflösung selbst – der Aufruf von `tp.user.<Skriptname>` – kann nur Templater übernehmen, da das Plugin keinen `tp`-Zugriff hat)

## Technische Hinweise

- `src/` ist die Quelle, `main.js` das über esbuild gebaute Bundle (`npm run dev` für Watch-Modus, `node esbuild.config.mjs production` für einen einmaligen Build)
- Die Graph-Einfärbung patcht `renderer.setData` zur Laufzeit (keine offizielle Obsidian-API dafür) – ähnlich wie es das Community-Plugin *graph-nested-tags* für Tag-Hierarchien tut
- Die TYP-Pane hält sich beim Hot-Reload (z. B. über das Hot-Reload-Plugin) selbst offen, da Obsidian eigene Views beim Plugin-Unload nicht automatisch wiederherstellt
- **TYP-Index** (`src/typ-index.js`): hält TYP und SUBTYP aller Notizen im Speicher und meldet per eigenem `change`-Event nur tatsächliche TYP-/SUBTYP-Änderungen (bzw. neue/gelöschte/umbenannte Notizen). Alle Einfärbungen und die TYP-Pane hängen an diesem Event statt direkt an `metadataCache` – normales Schreiben in einer Notiz löst damit kein Neu-Einfärben aus. Die Zählungen (TYP-Pane, Picker, `getTypes()`) werden dort zwischengespeichert. Zusätzlich lauscht die TYP-Pane auf das `vault`-Event `config-changed` (geänderte Excluded-Files-Liste)
- **Link-Einfärbung** (`src/link-colors.js`): überschreibt je Link nur `--link-color`/`--link-color-hover`. Im Lese-Modus per Markdown-Post-Processor, in Live Preview per CodeMirror-ViewPlugin, der nur den sichtbaren Bereich betrachtet (Links in Code-Blöcken werden über den Syntaxbaum ausgeschlossen). `@codemirror/*` ist deshalb in `esbuild.config.mjs` als extern markiert
- Der Standard-Frontmatter-Editor je Typ nutzt Obsidians eigenes (undokumentiertes) Property-Editor-Widget, gebunden an ein Plain-Object statt an eine echte Datei. Die globale Property-Reihenfolge baut dagegen bewusst eine eigene, schlichte Liste statt desselben Widgets – für die nicht entfernbaren, aber verschiebbaren Platzhalter-Zeilen wäre ein erneutes `synchronize()` aus dessen `saveFrontmatter`-Callback heraus nötig, was nachweislich zu einem Stack Overflow führen kann
