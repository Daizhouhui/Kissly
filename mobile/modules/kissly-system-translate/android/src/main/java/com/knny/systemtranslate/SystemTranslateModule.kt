package com.knny.systemtranslate

import com.google.android.gms.tasks.Tasks
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SystemTranslateModule : Module() {
  private fun normalizeLanguage(tag: String): String {
    val normalized = tag.trim().lowercase().replace('_', '-')
    if (normalized.isEmpty() || normalized == "auto") return TranslateLanguage.ENGLISH
    return TranslateLanguage.fromLanguageTag(normalized) ?: TranslateLanguage.ENGLISH
  }

  private fun translatorFor(from: String, to: String): Translator {
    val source = normalizeLanguage(from)
    val target = normalizeLanguage(to)
    val options = TranslatorOptions.Builder()
      .setSourceLanguage(source)
      .setTargetLanguage(target)
      .build()
    return Translation.getClient(options)
  }

  override fun definition() = ModuleDefinition {
    Name("KisslySystemTranslate")

    AsyncFunction("prepare") { from: String, to: String ->
      val translator = translatorFor(from, to)
      try {
        Tasks.await(translator.downloadModelIfNeeded())
        true
      } finally {
        translator.close()
      }
    }

    AsyncFunction("translate") { texts: List<String>, from: String, to: String ->
      val source = normalizeLanguage(from)
      val target = normalizeLanguage(to)
      if (source == target) {
        return@AsyncFunction texts
      }
      val translator = translatorFor(from, to)
      try {
        // Do not silently download a ~30 MB model from the automatic fallback
        // chain. The model is prepared explicitly from the translation settings.
        texts.map { text ->
          if (text.isBlank()) text else Tasks.await(translator.translate(text))
        }
      } finally {
        translator.close()
      }
    }
  }
}
