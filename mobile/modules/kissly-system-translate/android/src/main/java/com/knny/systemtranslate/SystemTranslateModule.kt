package com.knny.systemtranslate

import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.TimeUnit

class SystemTranslateModule : Module() {
  private fun normalizeLanguage(tag: String): String {
    val normalized = tag.trim().lowercase().replace('_', '-')
    if (normalized.isEmpty() || normalized == "auto") {
      throw IllegalArgumentException(
        "系统翻译需要明确的源语言，不能使用 auto。请改用 Microsoft、Google 或 DeepSeek。"
      )
    }
    // Never fall back to English: that silently translates Japanese or Korean
    // captions with an English model and produces garbage.
    return TranslateLanguage.fromLanguageTag(normalized)
      ?: throw IllegalArgumentException("系统翻译不支持语言：$tag")
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

    AsyncFunction("isAvailable") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      GoogleApiAvailability.getInstance()
        .isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    AsyncFunction("prepare") { from: String, to: String ->
      val translator = translatorFor(from, to)
      try {
        Tasks.await(translator.downloadModelIfNeeded(), 90, TimeUnit.SECONDS)
        true
      } catch (error: Exception) {
        throw Exception(
          "系统翻译语言包下载失败。Android 需要 Google Play 服务，并能访问 Google 服务器。可改用 Microsoft、Google 或 DeepSeek。",
          error
        )
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
          if (text.isBlank()) text
          else Tasks.await(translator.translate(text), 15, TimeUnit.SECONDS)
        }
      } finally {
        translator.close()
      }
    }
  }
}
