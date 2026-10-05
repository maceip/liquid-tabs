import AppKit

public enum CompactTabLabelMode: Equatable {
    case fixed
    case address
}

public struct CompactTabHoverContent: Equatable {
    public var title: String
    public var subtitle: String?
    public var detail: String?

    public init(title: String, subtitle: String? = nil, detail: String? = nil) {
        self.title = title
        self.subtitle = subtitle
        self.detail = detail
    }
}

public struct CompactTabHoverConfiguration: Equatable {
    public var delay: TimeInterval
    public var maximumWidth: CGFloat

    public init(delay: TimeInterval = 0.65, maximumWidth: CGFloat = 280) {
        self.delay = delay
        self.maximumWidth = maximumWidth
    }
}
