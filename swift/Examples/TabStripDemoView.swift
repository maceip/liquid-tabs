import SwiftUI
import CompactTabStrip

public struct TabStripDemoView: View {
    @State private var items: [CompactTabItem]
    @State private var selection: UUID

    public init() {
        let tab1 = CompactTabItem(title: "Overview", address: "app://overview", symbol: "house.fill", isPinned: true)
        let tab2 = CompactTabItem(title: "Editor", address: "app://editor", symbol: "chevron.left.forwardslash.chevron.right")
        let tab3 = CompactTabItem(title: "Terminal", address: "app://terminal", symbol: "terminal.fill")
        let tab4 = CompactTabItem(title: "Documentation", address: "https://docs.local", symbol: "book.fill")
        _items = State(initialValue: [tab1, tab2, tab3, tab4])
        _selection = State(initialValue: tab2.id)
    }

    public var body: some View {
        VStack(spacing: 0) {
            CompactTabStrip(
                items: items,
                selection: selection,
                onSelect: { selection = $0 },
                onClose: { id in
                    items.removeAll { $0.id == id }
                    if selection == id, let first = items.first {
                        selection = first.id
                    }
                },
                onInsert: {
                    let newItem = CompactTabItem(title: "New Tab", address: "")
                    items.append(newItem)
                    selection = newItem.id
                },
                onMove: { id, newIndex in
                    guard let oldIndex = items.firstIndex(where: { $0.id == id }) else { return }
                    let item = items.remove(at: oldIndex)
                    items.insert(item, at: min(newIndex, items.count))
                },
                onDetach: { id, point in
                    print("Detached tab \(id) at \(point)")
                },
                onSetPinned: { id, pinned in
                    guard let index = items.firstIndex(where: { $0.id == id }) else { return }
                    items[index].isPinned = pinned
                }
            )
            .frame(height: 36)
            .background(Color(nsColor: .windowBackgroundColor))

            Divider()

            ZStack {
                Color(nsColor: .controlBackgroundColor)
                if let selected = items.first(where: { $0.id == selection }) {
                    VStack(spacing: 12) {
                        Image(systemName: selected.symbol)
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text(selected.title)
                            .font(.title2.bold())
                        Text(selected.address.isEmpty ? "No address" : selected.address)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(minWidth: 600, minHeight: 400)
    }
}
