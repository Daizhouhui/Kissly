import ExpoModulesCore
import MLKitTranslate

public class SystemTranslateModule: Module {
  private func normalizeLanguage(_ tag: String) -> TranslateLanguage {
    let normalized = tag.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "_", with: "-")
    if normalized.isEmpty || normalized.lowercased() == "auto" {
      return .english
    }
    return TranslateLanguage.fromLanguageTag(normalized) ?? .english
  }

  private func makeTranslator(from: String, to: String) -> Translator {
    let source = normalizeLanguage(from)
    let target = normalizeLanguage(to)
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
      translateSequentially(translator, texts, index + 1, next, promise)
    }
  }

  public func definition() -> ModuleDefinition {
    Name("KisslySystemTranslate")

    AsyncFunction("prepare") { (from: String, to: String, promise: Promise) in
      let translator = self.makeTranslator(from: from, to: to)
      translator.downloadModelIfNeeded { error in
        if let error = error {
          promise.reject("ERR_SYSTEM_MODEL", error.localizedDescription)
        } else {
          promise.resolve(true)
        }
      }
    }

    AsyncFunction("translate") { (texts: [String], from: String, to: String, promise: Promise) in
      let source = self.normalizeLanguage(from)
      let target = self.normalizeLanguage(to)
      if source == target {
        promise.resolve(texts)
        return
      }
      let translator = self.makeTranslator(from: from, to: to)
      // The explicit prepare call owns downloading the model. Auto fallback
      // must fail fast instead of silently pulling a large language pack.
      self.translateSequentially(translator, texts, 0, [], promise)
    }
  }
}
