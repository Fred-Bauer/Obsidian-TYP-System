# TYP-System

Notiz-Typ-System für diesen Vault: eine eigene, links andockende **TYP-Pane** (Befehl „TYP-View öffnen“), ein nativer **TYP-Picker**, TYP-Frontmatter je Typ, Frontmatter-Sortierung sowie Einfärbung der Notiznamen nach ihrem `TYP`-Frontmatter in mehreren Ansichten. Ehemals Teil des Plugins **Fred**, seit der Aufteilung in ein eigenes Plugin ausgelagert.

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

- **Zwei Umbenennen-Buttons** nebeneinander: der normale (Bleistift) ändert nur die Plugin-Einstellungen (Farbe, Beschreibung, TYP-Frontmatter etc.); der davor hervorgehobene (Akzentfarbe, ebenfalls Bleistift) schreibt zusätzlich den TYP-Wert **aller betroffenen Notizen** um – vor dem Speichern erscheint dafür ein Bestätigungs-Modal mit der Anzahl betroffener Notizen
- **Zusammenlegen:** Umbenennen auf den Namen eines bereits registrierten Typs (egal über welchen der beiden Buttons) fragt, ob beide zusammengelegt werden sollen. Dabei werden die Notizen auf den Zieltyp umgeschrieben; Farbe, Beschreibung und TYP-Frontmatter des Quelltyps entfallen; seine Subtypen werden übernommen, gleichnamige Subtyp-Blöcke zusammengeführt (bei gleicher Property gewinnt das Ziel). Steht eine übernommene Subtyp-Property zugleich im TYP-Frontmatter des Ziels, bleiben beide stehen – daraus wird die normale Überschreibung
- **Löschen**-Button mit Bestätigungs-Modal
- In beiden Bestätigungs-Modalen wird der TYP-Name je nach Einstellung *TYP View einfärben* farbig oder mit vorangestelltem Farbpunkt dargestellt
- Notiz-Anzahl direkt neben dem Namen (muted)
- **„Manueller TYP“-Schalter** (standardmäßig an): steuert, ob dieser Typ im TYP-Picker (s. u.) standardmäßig zur Auswahl steht. Aus für Typen mit eigenem Erstellungsweg, die nicht manuell vergeben werden sollen (z. B. `KONTAKT`, `EXTERN`)
- Farbe (nativer Farbwähler mit Reset-Button) und frei editierbare Beschreibung
- **TYP-Frontmatter:** Obsidians natives Property-Widget – Properties, die neue Notizen dieses Typs automatisch bekommen (leer als auszufüllender Platzhalter, oder mit festem Wert)
- Befehl **„TYP-Property hinzufügen“** – legt eine neue Property im TYP-Frontmatter an: in der gerade fokussierten Detailansicht, sonst für den TYP der aktiven Notiz; ist keine Notiz offen oder hat sie keinen TYP, in der Detailansicht, die in der TYP-Pane gerade offen ist
- **Floating Properties:** kein eigener Abschnitt, sondern einzelne, kursiv dargestellte Zeilen innerhalb derselben Liste (per Drag & Drop an beliebiger Stelle einsortierbar) – über den zusätzlichen, hervorgehobenen „+“-Button links neben dem normalen hinzugefügt. Zählen genauso für die Frontmatter-Sortierung mit, werden aber NICHT automatisch bei neuen Notizen angelegt. Für Properties, die zu einem Typ gehören und an derselben Stelle einsortiert werden sollen wie die übrigen, aber nur bei Bedarf in einzelnen Notizen auftauchen. Templater bekommt sie nur, wenn `getTypeDefaults()` explizit mit `includeFloating: true` aufgerufen wird
- **Subtypen:** je Subtyp ein eigener Frontmatter-Block neben dem TYP-Frontmatter (Überschrift mit Notiz-Anzahl, Rechtsklick irgendwo in den Block öffnet die Suche; beim TYP-Frontmatter auf den Titel), mit denselben Möglichkeiten wie oben (Floating Properties, Platzhalter). Ein Subtyp gehört immer zu genau einem TYP, eine Notiz hat höchstens einen `SUBTYP` (wie bei TYP ein sauberer Einzelwert). Der Block ergänzt das TYP-Frontmatter für Notizen mit diesem SUBTYP. Dieselbe Property darf dabei in mehreren Blöcken stehen: in zwei Subtyp-Blöcken ist das konfliktfrei (eine Notiz hat höchstens einen SUBTYP, die Blöcke gelten also nie gleichzeitig), und steht sie zusätzlich im TYP-Frontmatter, **überschreibt der Subtyp** dessen Wert und dessen Floating-Markierung – die Zeile behält in der Notiz aber die Position des TYP-Frontmatters. Ein Subtyp kann eine Standard-Property damit auch gezielt „abschalten“, indem er sie bei sich als Floating markiert. Innerhalb **eines** Blocks bleibt jeder Name eindeutig. Per Drag & Drop (am Typ-Icon der Zeile) lässt sich eine Property sowohl innerhalb ihres Blocks umsortieren als auch in einen anderen Block ziehen – das Akzent-Rechteck zeigt dabei die Einfügestelle. Führt der Zielblock den Namen schon, werden beide zusammengelegt: der bestehende Eintrag behält Position, Wert und Floating-Markierung, nur ein leerer Wert wird aus der gezogenen Property gefüllt. Ein Drop außerhalb aller Blöcke lässt alles, wie es war
  - Subtyp-Namen werden je Wort mit großem Anfangsbuchstaben geschrieben („Kurz Geschichte“), die Property `SUBTYP` selbst bleibt in Großbuchstaben
  - Subtyp-Blöcke leuchten beim Hovern leicht auf (ebenso die nicht erfassten Subtypen) und lassen sich per Drag & Drop umsortieren: anfassbar ist der ganze Kasten außerhalb der Property-Zeilen (Überschrift, Abschluss, Ränder), ein Strich in Akzentfarbe zeigt die Zielposition, Escape bricht ab. Das TYP-Frontmatter steht immer ganz oben und ist nicht verschiebbar; der oberste mögliche Platz für einen Subtyp-Block ist direkt darunter
  - Der breite Button **„Subtyp hinzufügen“** legt einen neuen Block an, der Name wird inline eingegeben
  - Die Überschrift des TYP-Frontmatters heißt „[TYP]-Frontmatter“ (z. B. „ORGA-Frontmatter“) und steht in der TYP-Farbe (nur mit „TYP View“); die Anzahl daneben zählt die Notizen dieses TYPs ohne SUBTYP (Rechtsklick auf die Überschrift sucht sie)
  - Darunter die **nicht erfassten Subtypen** dieses TYPs, als Blöcke mit ausgegrauter Überschrift samt Anzahl: Linksklick übernimmt einen Wert (bereinigt, Großbuchstaben, SUBTYP der betroffenen Notizen wird mit umgeschrieben), Rechtsklick öffnet die Suche
  - Beim Anlegen einer Notiz stehen die Subtypen eingerückt unter ihrem TYP im TYP-Picker, bzw. mit der Einstellung „Subtyp-Picker separat“ folgt auf den TYP-Picker ein eigener Subtyp-Picker (siehe *TYP-Picker*)
  - **Subtyp-Farbe:** unten links im Subtyp-Block ein Farbpunkt, daneben Zurücksetzen. Ein Klick auf den Punkt öffnet drei Regler (Farbton, Sättigung, Helligkeit), deren Leisten als Verlauf die erreichbaren Farben zeigen. Gespeichert wird nur die Abweichung von der TYP-Farbe (berechnet in OKLCH): ändert sich die TYP-Farbe, ziehen die Subtypen mit. Ohne eigene Einstellung hat ein Subtyp die TYP-Farbe. Farbpunkte zeigen überall (TYP-Liste, Detailansicht, Picker, Bestätigungen, „Farbpunkt am Titel“ in der Notiz) den Standardwert als hohlen Ring: ein TYP ohne Farbe grau, ein Subtyp ohne eigene Einstellung in der TYP-Farbe, die er übernimmt; der Zurücksetzen-Button ist dann ausgegraut. Wie weit er abweichen darf, ist unter Einstellungen → *Subtyp-Farben* einstellbar (Standard ± 25° / 30 % / 20 %), größere Abweichungen werden darauf gekappt
  - Unten rechts in jedem Subtyp-Block dieselben Aktionen wie im Kopf der TYP-Detailansicht:
    - **Umbenennen (inkl. Notizen anpassen)** (Akzentfarbe): schreibt nach Bestätigung zusätzlich den SUBTYP der betroffenen Notizen um
    - **Umbenennen**: ändert nur die Einstellungen, der Block behält seine Position
    - **Löschen**: entfernt den Block samt seinen Properties. Eine Bestätigung kommt nur, wenn dabei Properties verloren gehen. Die Notizen behalten ihren SUBTYP-Wert, der danach unten als nicht erfasster Subtyp erscheint
    - Umbenennen auf den Namen eines anderen Subtyps desselben TYPs fragt, ob beide zusammengelegt werden sollen. Dabei wandern die Properties in den Ziel-Block – führt der Ziel-Block einen Namen schon, behält er Position, Wert und Floating-Markierung, nur ein leerer Wert wird aus der Quelle gefüllt –, und die Notizen werden immer mit umgeschrieben
- **Platzhalter** im TYP-Frontmatter bzw. bei Floating Properties (Legende ganz unten):
  - `{{today}}` – heutiges Datum (JJJJ-MM-TT)
  - `{{now}}` – aktuelles Datum mit Uhrzeit (JJJJ-MM-TT HH:mm)
  - `{{created}}` – Erstellungsdatum der Datei (JJJJ-MM-TT), nicht der Aufrufzeitpunkt
  - `{{tp.<Skriptname>}}` – ruft beim Anlegen einer Notiz dynamisch das gleichnamige Templater-Skript (`tp.user.<Skriptname>`) auf und übernimmt dessen Rückgabewert – ein einzelner Wert, oder ein Objekt mit Werten für mehrere Properties des TYPs (z. B. `{{tp.quelle}}` bei `Quelle` füllt zusätzlich `Titel`/`Autor`, `{{tp.quelleEditName}}` benennt die Notiz außerdem nach der gewählten PDF um); siehe *Templater-Integration*

  Erkannte Platzhalter werden farblich hervorgehoben, Obsidians „Type mismatch“-Warnung wird für sie unterdrückt.

  **Vorschläge:** Beginnt ein Wert mit `{`, schlägt Obsidians normale Werte-Vorschlagsliste (nur bei Text- und Listen-Properties) zusätzlich alle Platzhalter vor – die festen sowie `{{tp.<Skriptname>}}` für jedes Templater-Skript im Templater-Skript-Ordner, das in einem Kommentar den Marker `@typ-shortcut` trägt (z. B. `// @typ-shortcut`). Reine Hilfsskripte ohne Marker erscheinen nicht. Gilt nur im TYP-Frontmatter-Editor, nicht in Notizen

## TYP-Picker

Nativer Ersatz für Templaters eigenen `tp.system.suggester` bei der Typ-Auswahl (baut auf Obsidians `FuzzySuggestModal` auf):

- Zeigt Typ-Farbe bzw. Farbpunkt (je nach Einfärbungs-Einstellung), Beschreibung (muted) und Notiz-Anzahl je Zeile
- Blendet standardmäßig Typen mit deaktiviertem „Manueller TYP“-Schalter aus (per Parameter einschließbar)
- Kann optional auch unregistrierte Typen mit auflisten
- Wird sowohl von den eigenen Befehlen dieses Plugins als auch von Templater-Skripten genutzt (siehe *Templater-Integration*)
- **Subtypen** (beim Anlegen einer Notiz über `TYP.js`): standardmäßig eingerückt direkt unter ihrem TYP, in ihrer eigenen Farbe (bzw. mit Farbpunkt; mit ausgeschaltetem Unter-Schalter „Subtyp“ bei *TYP View* in der des TYPs). Die TYP-Zeile selbst bedeutet „ohne Subtyp“. Die Suche arbeitet gruppenweise: passt sie auf einen TYP, bleiben alle seine Subtypen stehen; passt sie nur auf einen Subtyp, bleibt sein TYP darüber stehen – ein Subtyp erscheint nie ohne seinen TYP
- Einstellung **„Subtyp-Picker separat“** (Einstellungen → TYP-System → *TYP-Picker*): stattdessen erst der TYP-Picker, danach ein eigener Subtyp-Picker, sobald der TYP Subtypen hat (ausgegraut am Ende „Kein Subtyp“, ESC dort führt zurück zur TYP-Auswahl)

## Frontmatter-Sortierung

Bringt die in einer Notiz vorhandenen Properties in eine feste Reihenfolge (ergänzt oder ändert keine Werte):

- Editierbare **globale Reihenfolge** (Einstellungen → TYP-System, per Drag & Drop) aus frei platzierbaren Einzel-Properties (z. B. `cssclasses`, `aliases`, keine Dopplungen möglich) sowie vier nicht entfernbaren Platzhaltern: die `TYP`- und die `SUBTYP`-Property selbst, die TYP-Frontmatter-Liste des jeweiligen Typs („TYP-Frontmatter“, inkl. dessen Floating Properties an ihrer jeweiligen Position innerhalb dieser Liste, direkt gefolgt von den zusätzlichen Properties aus dem Block des SUBTYPs der Notiz), und „Sonstige Properties“ für den Rest. Eine fest platzierte Einzel-Property hat dabei immer Vorrang vor ihrem Vorkommen in der Standardliste eines Typs, unabhängig davon, wo „TYP-Frontmatter“ in der Liste steht
- Play-Button neben der Überschrift wendet die aktuelle Reihenfolge sofort auf den gesamten Vault an (identisch zum Befehl „Frontmatter Sortierung GLOBAL aktualisieren“)
- Befehl **„Frontmatter Sortierung GLOBAL aktualisieren“** – über den ganzen Vault
- Befehl **„Frontmatter Sortierung für TYP aktualisieren“** – fragt über den TYP-Picker (inkl. nicht registrierter und manuell deaktivierter Typen) einen Typ ab und sortiert nur dessen Notizen; ohne gepflegtes TYP-Frontmatter greift nur die globale Reihenfolge (mit entsprechendem Hinweis in der Rückmeldung)
- Befehl **„Frontmatter Sortierung der aktiven Notiz aktualisieren“**
- Jeder Lauf meldet per Notice geprüfte/sortierte Notizen bzw. bei einem Fehler dessen Meldung, statt lautlos nichts zu tun; ein Vorab-Check über den bereits im Speicher vorhandenen Metadata-Cache sorgt dafür, dass bereits korrekt sortierte Notizen bei wiederholten Läufen nicht extra geöffnet/geschrieben werden
- **Umbenennen einer Property** über Obsidians „All properties“-Ansicht (bzw. in Bases beim Benennen einer neu angelegten Notiz-Property) wird automatisch ins TYP-Frontmatter aller Typen, deren Floating-Markierungen und die globale Reihenfolge übernommen – Position und Wert bleiben erhalten, Groß-/Kleinschreibung wird beim Abgleich ignoriert. Existiert der neue Name dort schon, werden beide zusammengelegt (der bestehende Eintrag bleibt, übernimmt aber den alten Wert, falls er selbst leer ist). Ein reiner Anzeigename in Bases ändert die Notizen nicht und daher auch hier nichts
- optional: Property-Namen, die im TYP-Frontmatter eines Typs stehen, in Notizen (Frontmatter-Widget und „All Properties“-Ansicht) fett markieren – als Floating Property markierte darunter stattdessen kursiv. Unter-Schalter „Subtyp“: bezieht den Block des SUBTYPs der Notiz mit ein

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
- **All Properties** – Property-Namen, die im TYP-Frontmatter genau eines Typs vorkommen, in dessen Farbe; kommen sie bei mehreren Typen vor, stattdessen fett. Kursiv werden sie, wenn sie **überall** als Floating Property markiert sind – in jedem Block jedes Typs, der sie führt; fett und kursiv können daher zusammentreffen. Mit dem Unter-Schalter „Subtyp“ zählt eine Property aus einem Subtyp-Block für dessen TYP und wird in der Farbe dieses Subtyps eingefärbt – aber nur, wenn sie in genau einem Block des Typs steht; bei mehreren Blöcken wäre die Wahl willkürlich, dann gilt die TYP-Farbe

Jede Ansicht lässt sich einzeln ein-/ausschalten. Darunter hat jede einen Unter-Schalter **„Subtyp“** (Standard: an): Notizen mit SUBTYP erscheinen dann in der Farbe ihres Subtyps statt der ihres TYPs – ebenso der Farbpunkt am Titel und der Titel-Text. Die **Box mit TYP-Namen** hat stattdessen eine eigene *Beschriftung*: [TYP] (TYP-Farbe), [TYP/Subtyp] (mit „Farbig“ zusätzlich wählbar: *Subtyp-Farbe*) oder [Subtyp] (Subtyp-Farbe; Notizen ohne Subtyp bekommen dann keine Box). Farbig erscheint die Box bei einem registrierten TYP ohne eigene Farbe in Grau. Zusätzlich lässt sich unabhängig davon eine eigene **Tag-Farbe** sowie eine **Anhänge-Farbe** für entsprechende Knoten im Graph aktivieren.

Einstellungen: **TYP-System** → *Einfärbung* (pro Ansicht ein-/ausschalten) bzw. *Graph* (Tag-/Anhänge-Farbe).

## Templater-Integration

Das Plugin selbst enthält keine Templater-Logik, stellt aber eine kleine API auf dem Plugin-Objekt bereit (`app.plugins.plugins["typ-system"]`), die `_obsidian/templater-scripts/TYP.js` (und darauf aufbauende Templates) beim Anlegen neuer Notizen nutzt:

- `getTypes({ includeManualOff })` – Typen mit Beschreibung und Notiz-Anzahl, in der aktuellen TYP-Pane-Sortierung
- `getTypeDefaults(type, { includeFloating, file, subtype })` – aufgelöstes TYP-Frontmatter des Typs (feste Platzhalter wie `{{today}}` bereits eingesetzt); mit `includeFloating: true` zusätzlich die Floating Properties des Typs (standardmäßig ausgeklammert); `file` wird an `{{created}}` durchgereicht (Erstellungsdatum der Datei statt des Aufrufzeitpunkts) und sollte beim Anlegen einer neuen Notiz mitgegeben werden; mit `subtype` wird dessen Block dahinter angehängt; eine Property, die in beiden Blöcken steht, behält die Position des TYP-Frontmatters, Wert und Floating-Markierung kommen vom Subtyp
- `pickType({ includeManualOff, includeUnregistered })` – öffnet den nativen TYP-Picker, löst mit dem gewählten Typ oder `null` auf
- `getSubtypes(type)` – registrierte Subtypen des Typs in Block-Reihenfolge, je `{ subtype, count }`
- `pickSubtype(type)` – öffnet den Subtyp-Picker (Subtypen mit Notiz-Anzahl, am Ende ausgegraut „Kein Subtyp“); löst mit dem Subtyp auf, mit `""` für „Kein Subtyp“ (bzw. sofort ohne Picker, wenn der Typ keine Subtypen hat) oder mit `null` bei ESC. `TYP.js` kehrt bei ESC zur TYP-Auswahl zurück (erst ESC dort bricht ab)
- `pickTypeAndSubtype({ includeManualOff, includeUnregistered })` – TYP und Subtyp in einem Zug, je nach Einstellung „Subtyp-Picker separat“ über den kombinierten Picker oder beide Picker nacheinander (siehe *TYP-Picker*); löst mit `{ type, subtype }` auf (`subtype` ist `null` für „ohne Subtyp“) oder mit `null` bei ESC. `TYP.js` nutzt ausschließlich diese Funktion
- `applyTypeProperties(frontmatter, type, subtype)` – setzt innerhalb von `processFrontMatter` TYP und SUBTYP in einheitlicher Schreibweise (eine Variante wie `typ`/`Subtyp` wird an ihrer Stelle umbenannt statt verdoppelt); ohne `subtype` wird ein vorhandener SUBTYP entfernt. Die Properties aus dessen Block entfernt `TYP.js` dabei nur, wenn sie leer sind – wie beim Wechsel des TYPs
- `sortFrontmatter(frontmatter, type, subtype)` – bringt innerhalb von `processFrontMatter` das Frontmatter in die Reihenfolge der Frontmatter-Sortierung, mit ausdrücklich übergebenem TYP/Subtyp (Index und Metadata-Cache kennen die gerade geschriebenen Werte da noch nicht). `TYP.js` ruft es zum Schluss auf, damit auch bei erneutem Ausführen auf einer bestehenden Notiz neu ergänzte Properties wie SUBTYP an ihrem Platz landen statt am Ende
- `placeProperty(frontmatter, key)` – setzt innerhalb von `processFrontMatter` nur die eine Property `key` an ihren Platz laut Frontmatter-Sortierung (direkt hinter ihren nächsten Vorgänger in der vollständig sortierten Reihenfolge), alle übrigen bleiben unverändert; TYP/SUBTYP werden aus dem Objekt selbst gelesen. Genutzt von Freds Property-Backlinking (Schalter „Reihenfolge aus TYP-System übernehmen“), damit neu angelegte Properties nicht am Ende landen
- `matchDynamicPlaceholder(value)` – erkennt einen `{{tp.<Skriptname>}}`-Wert und liefert den Skriptnamen (die Auflösung selbst – der Aufruf von `tp.user.<Skriptname>` – kann nur Templater übernehmen, da das Plugin keinen `tp`-Zugriff hat). Skriptnamen dürfen Umlaute, `-` und Leerzeichen enthalten, nur keine geschweiften Klammern

### Konvention für `{{tp.<Skriptname>}}`-Skripte

Umgesetzt in `TYP.js`, damit möglichst jedes Templater-Skript als Shortcut im TYP-Frontmatter taugt:

- **Aufruf:** `tp.user.<Skriptname>(tp, newFile, { typ, subtyp, key, werte, danach })` – `newFile` ist die neue Notiz, `subtyp` der gewählte Subtyp oder `null`, `key` die Property des Platzhalters, `werte` die bis dahin aufgelösten Standardwerte (Skripte laufen nacheinander in der Reihenfolge des TYP-Frontmatters). Skripte, die nur `tp` erwarten, funktionieren unverändert
- **`danach(fn)`:** merkt eine (async) Aktion vor, die erst nach dem Schreiben des Frontmatters läuft, der Reihe nach – für Seiteneffekte an der Datei selbst, z. B. Umbenennen (`quelleEditName`). Ein eigener `tp.hooks.on_all_templates_executed`-Hook im Skript liefe dagegen parallel zum Schreiben und könnte bei einer Umbenennung eine zweite Datei erzeugen
- **Rückgabe – Einzelwert** (Text, Zahl, Liste, `null`/`undefined`): wird Wert dieser Property
- **Rückgabe – einfaches Objekt:** Werte für mehrere Properties. Die Property des Platzhalters bekommt ihren Eintrag daraus; weitere Einträge füllen nur Properties, die zum TYP gehören (TYP-Frontmatter inkl. Floating Properties) und noch leer sind – alles andere im Objekt wird ignoriert. Floating Properties werden dabei nur angelegt, wenn sie tatsächlich einen Wert bekommen
- Hat die Notiz für die Property schon einen Wert (erneutes Ausführen auf einer bestehenden Notiz), wird das Skript nicht aufgerufen
- Fehlt das Skript oder wirft es einen Fehler, erscheint eine Notice und die Property bleibt leer – TYP und übrige Properties werden trotzdem geschrieben

## Technische Hinweise

- `src/` ist die Quelle, `main.js` das über esbuild gebaute Bundle (`npm run dev` für Watch-Modus, `node esbuild.config.mjs production` für einen einmaligen Build)
- Die Graph-Einfärbung patcht `renderer.setData` zur Laufzeit (keine offizielle Obsidian-API dafür) – ähnlich wie es das Community-Plugin *graph-nested-tags* für Tag-Hierarchien tut
- Die Übernahme von Property-Umbenennungen (`src/property-rename-sync.js`) wrappt `app.fileManager.renameProperty` – über diese eine Methode laufen sowohl die „All properties“-Ansicht als auch Bases. Die Plugin-Einstellungen werden erst nach erfolgreichem Umschreiben der Notizen angepasst
- Die TYP-Pane hält sich beim Hot-Reload (z. B. über das Hot-Reload-Plugin) selbst offen, da Obsidian eigene Views beim Plugin-Unload nicht automatisch wiederherstellt
- **TYP-Index** (`src/typ-index.js`): hält TYP und SUBTYP aller Notizen im Speicher (Property-Namen ohne Beachtung der Groß-/Kleinschreibung gelesen, wie Obsidian selbst; beim Umschreiben durch das Plugin wird ein abweichend geschriebener Name wie `Subtyp` an derselben Position zu `SUBTYP` vereinheitlicht) und meldet per eigenem `change`-Event nur tatsächliche TYP-/SUBTYP-Änderungen (bzw. neue/gelöschte/umbenannte Notizen). Alle Einfärbungen und die TYP-Pane hängen an diesem Event statt direkt an `metadataCache` – normales Schreiben in einer Notiz löst damit kein Neu-Einfärben aus. Die Zählungen (TYP-Pane, Picker, `getTypes()`) werden dort zwischengespeichert. Zusätzlich lauscht die TYP-Pane auf das `vault`-Event `config-changed` (geänderte Excluded-Files-Liste)
- **Subtypen** (`src/subtypes.js`): gespeichert unter `typeSubtypes` als `{ TYP: { SUBTYP: { frontmatter, floatingKeys } } }`, die Schlüsselreihenfolge ist die Reihenfolge der Blöcke. Ein Key darf in mehreren Blöcken eines TYPs stehen; eindeutig ist er nur innerhalb eines Blocks (dort erzwingt das Frontmatter-Objekt selbst es). Eine Umbenennung über „All properties“ schlägt deshalb auf jeden Block durch, in dem der Key steht. `getTypeDefaults` (main.js) und `orderedDefaultKeys` (frontmatter-sort.js) müssen für eine Dopplung dieselbe Positionsregel verwenden – sonst sortiert die Frontmatter-Sortierung eine gerade angelegte Notiz sofort wieder um. Der Frontmatter-Editor arbeitet über eine kleine Speicher-Schnittstelle (`typeStore`/`subtypeStore` in `src/type-frontmatter-editor.js`), die auch Floating-Menü und Property-Umbenennung nutzen
- **Frontmatter-Blöcke** (`src/frontmatter-blocks.js`): je Block ein eigener Container mit eigener Obsidian-Property-Editor-Instanz (gebunden an `typeStore`/`subtypeStore`). Nur so sind doppelte Keys über Blockgrenzen möglich – ein einziger, gemeinsamer Editor hielte alle Blöcke in **einem** flachen Objekt und könnte denselben Namen gar nicht zweimal darstellen. Zwei Dinge, die dadurch je Instanz enden, sind nachgerüstet:
  - **Tastatur-Navigation** über alle Blöcke: Obsidian erreicht seine `shiftFocusBefore`/`shiftFocusAfter`-Haken nur über die hier ausgeblendete Überschrift bzw. den „Add property“-Button, daher ein eigener Handler in der Capture-Phase (`registerFocusChain` in `type-frontmatter-editor.js`), der nur greift, wenn die Zeile selbst den Fokus hat – beim Tippen in einem Feld also nie
  - **Zeilen-Drag über Blockgrenzen** (`registerPropertyDrag`): setzt auf Obsidians eigenem Drag auf, statt ein zweites danebenzustellen. Dessen Ghost hängt ohnehin am `document.body` und folgt dem Cursor überallhin; dazu kommen nur ein leeres Zusatzkind in der Zeilenliste (sonst startet Obsidian den Drag gar nicht, wenn ein Block nur eine Zeile hat – Prüfung `n.firstChild !== n.lastChild`), ein Platzhalter mit Obsidians eigener Klasse `.drag-ghost-hidden` im Zielblock und ein `reorderKey` je Instanz, das beim Loslassen über einem fremden Block umhängt statt zu sortieren
- **Link-Einfärbung** (`src/link-colors.js`): überschreibt je Link nur `--link-color`/`--link-color-hover`. Im Lese-Modus per Markdown-Post-Processor, in Live Preview per CodeMirror-ViewPlugin, der nur den sichtbaren Bereich betrachtet (Links in Code-Blöcken werden über den Syntaxbaum ausgeschlossen). `@codemirror/*` ist deshalb in `esbuild.config.mjs` als extern markiert
- **Platzhalter-Vorschläge** (`src/placeholder-suggest.js`): umhüllen `metadataCache.getFrontmatterPropertyValuesForKey`, aus dem Obsidians Wert-Vorschläge ihre Kandidaten beziehen – nur wenn der Fokus in einem Wert-Feld des TYP-Frontmatter-Editors liegt und der Wert mit `{` beginnt, sonst unverändert. Die Liste markierter Skripte wird vorab aus Templaters Skript-Ordner gelesen und bei Dateiänderungen darin nachgeführt
- Der TYP-Frontmatter-Editor je Typ nutzt Obsidians eigenes (undokumentiertes) Property-Editor-Widget, gebunden an ein Plain-Object statt an eine echte Datei. Die globale Property-Reihenfolge baut dagegen bewusst eine eigene, schlichte Liste statt desselben Widgets – für die nicht entfernbaren, aber verschiebbaren Platzhalter-Zeilen wäre ein erneutes `synchronize()` aus dessen `saveFrontmatter`-Callback heraus nötig, was nachweislich zu einem Stack Overflow führen kann
