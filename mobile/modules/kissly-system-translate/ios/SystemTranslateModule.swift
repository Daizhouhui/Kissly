import ExpoModulesCore
import Foundation
import MLKitTranslate

public class SystemTranslateModule: Module {
  private func normalizeLanguage(_ tag: String, field: String) throws -> TranslateLanguage {
    let normalized = tag.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "_", with: "-")
    if normalized.isEmpty || normalized.lowercased() == "auto" {
      throw NSError(
        domain: "KisslySystemTranslate",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey:
            "系统翻译需要明确的\(field)语言，不能使用 auto 或空值。"
        ]
      )
    }
    // ML Kit's iOS header exposes TranslateLanguage as an NSString-backed
    // typed enum and does not provide the `fromLanguageTag` helper shown in
    // some online docs. It expects the base ISO-639 code (e.g. `en`, `zh`).
    let base = normalized.split(separator: "-").first.map(String.init) ?? normalized
    return TranslateLanguage(rawValue: base)
  }

  private func makeTranslator(from: String, to: String) throws -> Translator {
    let source = try normalizeLanguage(from, field: "源")
    let target = try normalizeLanguage(to, field: "目标")
    return Translator.translator(
      options: TranslatorOptions(sourceLanguage: source, targetLanguage: target)
    )
  }

  private func translateSequentially(
    _ translator: Translator,
    _ texts: [String],
    _ index: Int,
    _ output: [String],
    _ promise: Promise
  ) {
    if index >= texts.count {
      promise.resolve(output)
      return
    }
    let text = texts[index]
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      var next = output
      next.append(text)
      translateSequentially(translator, texts, index + 1, next, promise)
      return
    }
    translator.translate(text) { translated, error in
      if let error = error {
        promise.reject("ERR_SYSTEM_TRANSLATE", error.localizedDescription)
        return
      }
      var next = output
      next.append(translated ?? text)
      self.translateSequentially(translator, texts, index + 1, next, promise)
    }
  }

  public func definition() -> ModuleDefinition {
    Name("KisslySystemTranslate")

    AsyncFunction("isAvailable") { true }

    AsyncFunction("prepare") { (from: String, to: String, promise: Promise) in
      do {
        let translator = try self.makeTranslator(from: from, to: to)
        translator.downloadModelIfNeeded { error in
          if let error = error {
            promise.reject("ERR_SYSTEM_MODEL", error.localizedDescription)
          } else {
            promise.resolve(true)
          }
        }
      } catch {
        promise.reject("ERR_SYSTEM_LANGUAGE", error.localizedDescription)
      }
    }

    AsyncFunction("translate") { (texts: [String], from: String, to: String, promise: Promise) in
      do {
        let source = try self.normalizeLanguage(from, field: "源")
        let target = try self.normalizeLanguage(to, field: "目标")
        if source == target {
          promise.resolve(texts)
          return
        }
        let translator = try self.makeTranslator(from: from, to: to)
        // The explicit prepare call owns downloading the model. Auto fallback
        // must fail fast instead of silently pulling a large language pack.
        self.translateSequentially(translator, texts, 0, [], promise)
      } catch {
        promise.reject("ERR_SYSTEM_LANGUAGE", error.localizedDescription)
      }
    }
  }
}
