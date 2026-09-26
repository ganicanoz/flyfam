import UserNotifications

/// Downloads Expo Push `richContent.image` for iOS notification attachments.
/// Expo places the URL at `userInfo["body"]["_richContent"]["image"]`.
/// If download fails, the original title/body/sound are still delivered.
class NotificationService: UNNotificationServiceExtension {
  var contentHandler: ((UNNotificationContent) -> Void)?
  var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

    guard let bestAttemptContent = bestAttemptContent else {
      contentHandler(request.content)
      return
    }

    guard let imageUrl = Self.resolveImageURL(from: request.content.userInfo) else {
      contentHandler(bestAttemptContent)
      return
    }

    downloadAndAttachImage(url: imageUrl, to: bestAttemptContent) { content in
      contentHandler(content)
    }
  }

  /// Expo Push: body._richContent.image — also accept a few safe fallbacks.
  private static func resolveImageURL(from userInfo: [AnyHashable: Any]) -> URL? {
    if let body = userInfo["body"] as? [String: Any] {
      if let rich = body["_richContent"] as? [String: Any],
         let s = rich["image"] as? String,
         let url = URL(string: s),
         url.scheme == "https" {
        return url
      }
      if let s = body["image"] as? String, let url = URL(string: s), url.scheme == "https" {
        return url
      }
    }
    if let rich = userInfo["_richContent"] as? [String: Any],
       let s = rich["image"] as? String,
       let url = URL(string: s),
       url.scheme == "https" {
      return url
    }
    if let s = userInfo["image"] as? String, let url = URL(string: s), url.scheme == "https" {
      return url
    }
    return nil
  }

  private func downloadAndAttachImage(
    url: URL,
    to content: UNMutableNotificationContent,
    completion: @escaping (UNNotificationContent) -> Void
  ) {
    let task = URLSession.shared.downloadTask(with: url) { temporaryFileLocation, response, _ in
      guard let temporaryFileLocation = temporaryFileLocation else {
        completion(content)
        return
      }

      let fileManager = FileManager.default
      let tempDirectory = URL(fileURLWithPath: NSTemporaryDirectory())
      let ext: String = {
        if let mime = (response as? HTTPURLResponse)?.mimeType {
          if mime.contains("png") { return "png" }
          if mime.contains("jpeg") || mime.contains("jpg") { return "jpg" }
        }
        let pathExt = url.pathExtension.lowercased()
        if pathExt == "png" || pathExt == "jpg" || pathExt == "jpeg" { return pathExt == "jpeg" ? "jpg" : pathExt }
        return "jpg"
      }()
      let targetUrl = tempDirectory.appendingPathComponent(
        "flyfam-notif-\(UUID().uuidString).\(ext)"
      )

      try? fileManager.removeItem(at: targetUrl)

      do {
        try fileManager.moveItem(at: temporaryFileLocation, to: targetUrl)
        let attachment = try UNNotificationAttachment(
          identifier: "flyfam-image",
          url: targetUrl,
          options: nil
        )
        content.attachments = [attachment]
      } catch {
        // Keep original notification content (text + sound).
      }

      completion(content)
    }

    task.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
      contentHandler(bestAttemptContent)
    }
  }
}
