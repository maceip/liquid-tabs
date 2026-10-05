# Compact Tab Strip (`compact-tab-strip`)

A high-performance, cross-platform Safari-style compact glass tab strip library for **macOS (SwiftUI/AppKit)** and the **Web (HTML/TypeScript)**.

Based on the refined desktop browser tab architecture with 100% visual and behavioral parity across native Apple platforms and modern browsers.

---

## Highlights

* **Safari Glass Design:** 36px compact bar, 18px rounded pills, dynamic backdrop refraction, specular rims, and automatic light/dark theme adaptation.
* **Pinned Tabs:** Inactive pins collapse to compact square icon glyphs; selecting a pin expands its title and address field.
* **Fluid Drag & Reorder:** Physics-based slot swapping with escape band protection and spring-interpolated transitions.
* **Tear-Off Detachment:** Pulling a tab vertically morphs the pill into a scaled page miniature. Releasing outside detaches into an independent window (`NSWindow` on macOS, native popup window on Web).
* **Stationary Hover Popovers:** 650ms debounced metadata cards with zero pointer interference.
* **Zero External Dependencies:**
  * **Swift:** Only Apple system frameworks (`AppKit`, `SwiftUI`, `CoreImage`).
  * **Web:** Pure vanilla TypeScript and standard DOM APIs (no React/Vue runtime overhead).

For the complete architectural analysis, see [**REVIEW.md**](./REVIEW.md).

---

## Directory Structure

```
tab-strip-port/
├── README.md                      # This guide
├── REVIEW.md                      # In-depth architectural & parity review
├── swift/                         # Swift Package Manager (SPM) library
│   ├── Package.swift              # SPM manifest (macOS 13+)
│   ├── Sources/CompactTabStrip/   # Native SwiftUI / AppKit sources
│   │   ├── CompactTabStrip.swift  # Main NSViewRepresentable & NSView
│   │   ├── TabHoverPreview.swift  # Floating NSPanel hover popover
│   │   ├── TabPresentation.swift  # Configuration types & enums
│   │   ├── TabStripGeometry.swift # Slot layout calculations
│   │   └── TabStripWindowDragGuard.swift
│   └── Examples/
│       └── TabStripDemoView.swift # Drop-in SwiftUI example view
├── web/                           # npm / TypeScript DOM library
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── src/                       # TypeScript module sources
│   │   ├── index.ts               # Package exports
│   │   ├── tab-strip.ts           # Core DOM TabStrip class
│   │   ├── tabs.css               # Glass pill styling & variables
│   │   └── ...
│   └── dist/                      # Pre-compiled bundles
└── standalone/                    # Zero-dependency single-file HTML components
    ├── pie-tab-bar.html           # Inline embeddable component (<style> + <script>)
    ├── pie-tab-bar-preview.html   # Full interactive browser preview with controls
    └── tab-bar-inline.template.html
```

---

## 1. Native SwiftUI / macOS Integration

### 1.1 Adding the Package

In your `Package.swift`:

```swift
dependencies: [
    .package(path: "../compact-tab-strip/swift") // or git URL
],
targets: [
    .target(
        name: "YourApp",
        dependencies: ["CompactTabStrip"]
    )
]
```

Or drag the `swift/` folder directly into your Xcode project.

### 1.2 SwiftUI Usage

```swift
import SwiftUI
import CompactTabStrip

struct ContentView: View {
    @State private var tabs = [
        CompactTabItem(title: "Overview", address: "app://overview", symbol: "house.fill", isPinned: true),
        CompactTabItem(title: "Editor", address: "app://editor", symbol: "chevron.left.forwardslash.chevron.right"),
        CompactTabItem(title: "Terminal", address: "app://terminal", symbol: "terminal.fill")
    ]
    @State private var selection: UUID = UUID()

    var body: some View {
        CompactTabStrip(
            items: tabs,
            selection: selection,
            onSelect: { selection = $0 },
            onClose: { id in
                tabs.removeAll { $0.id == id }
                if selection == id, let first = tabs.first { selection = first.id }
            },
            onInsert: {
                let newTab = CompactTabItem(title: "New Tab", address: "")
                tabs.append(newTab)
                selection = newTab.id
            },
            onMove: { id, targetIndex in
                guard let oldIndex = tabs.firstIndex(where: { $0.id == id }) else { return }
                let item = tabs.remove(at: oldIndex)
                tabs.insert(item, at: min(targetIndex, tabs.count))
            },
            onDetach: { id, screenPoint in
                // Open new NSWindow at screenPoint with the detached tab
            },
            onSetPinned: { id, isPinned in
                guard let idx = tabs.firstIndex(where: { $0.id == id }) else { return }
                tabs[idx].isPinned = isPinned
            }
        )
        .frame(height: 36)
    }
}
```

---

## 2. Web / TypeScript Integration

### 2.1 Installation

```bash
cd web
npm install
npm run build
```

### 2.2 Vanilla JavaScript / TypeScript

```typescript
import { TabStrip, fullEffects } from 'compact-tab-strip';
import 'compact-tab-strip/tabs.css';

const container = document.querySelector('#tabs-container')!;

const tabStrip = new TabStrip(container, {
  tabs: [
    { id: 'home', title: 'Home', address: 'app://home', icon: { glyph: 'H' } },
    { id: 'docs', title: 'Docs', address: 'app://docs', icon: { glyph: 'D' } }
  ],
  effects: fullEffects,
  onSelect(tab) {
    console.log('Selected:', tab.id);
  },
  onClose(id) {
    tabStrip.close(id);
  },
  onMove(id, newIndex) {
    console.log('Moved', id, 'to', newIndex);
  },
  onDetach(tab) {
    // Custom window.open popup handoff
  }
});

// Programmatic control:
tabStrip.pin('home', true);
tabStrip.setTheme('dark'); // 'dark' | 'light'
```

---

## 3. Standalone Single-File Drop-In (HTML)

For fast prototyping or embedding without a build step:

Open [`standalone/pie-tab-bar-preview.html`](./standalone/pie-tab-bar-preview.html) directly in any browser. It contains the full UI, controls, animations, theme toggles, and drag-and-drop tear-off sandbox in a single self-contained file.
