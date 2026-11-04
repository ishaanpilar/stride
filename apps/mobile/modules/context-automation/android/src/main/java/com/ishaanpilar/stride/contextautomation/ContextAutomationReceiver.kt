package com.ishaanpilar.stride.contextautomation

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService

private const val ACTIVATE_CONTEXT_ACTION = "com.ishaanpilar.stride.action.ACTIVATE_CONTEXT"
private const val DEACTIVATE_CONTEXT_ACTION = "com.ishaanpilar.stride.action.DEACTIVATE_CONTEXT"

class ContextAutomationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val payload = ContextAutomationPayload.fromIntent(intent) ?: return
    val serviceIntent = Intent(context, ContextAutomationHeadlessService::class.java).apply {
      putExtra("action", payload.action)
      putExtra("context", payload.context)
      putExtra("source", "android_broadcast")
    }

    context.startService(serviceIntent)
    HeadlessJsTaskService.acquireWakeLockNow(context)
  }
}

private data class ContextAutomationPayload(
  val action: String,
  val context: String
) {
  companion object {
    fun fromIntent(intent: Intent?): ContextAutomationPayload? {
      val contextAction = when (intent?.action) {
        ACTIVATE_CONTEXT_ACTION -> "activate"
        DEACTIVATE_CONTEXT_ACTION -> "deactivate"
        else -> return null
      }

      fun clean(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        return if (trimmed.isBlank()) null else trimmed
      }

      val data = intent.data
      val ignoredPathSegments = setOf("context", "contexts", "activate", "deactivate")
      val pathContext = data?.pathSegments
        ?.filter { segment -> !ignoredPathSegments.contains(segment) }
        ?.joinToString("/")
      val hostContext = data?.host?.takeIf { host -> host != "context" && host != "contexts" }
      val rawContext = clean(intent.getStringExtra("context"))
        ?: clean(intent.getStringExtra("name"))
        ?: clean(intent.getStringExtra("token"))
        ?: clean(intent.getStringExtra(Intent.EXTRA_TEXT))
        ?: clean(data?.getQueryParameter("context"))
        ?: clean(data?.getQueryParameter("name"))
        ?: clean(data?.getQueryParameter("token"))
        ?: clean(pathContext)
        ?: clean(hostContext)
        ?: return null

      return ContextAutomationPayload(contextAction, rawContext)
    }
  }
}
