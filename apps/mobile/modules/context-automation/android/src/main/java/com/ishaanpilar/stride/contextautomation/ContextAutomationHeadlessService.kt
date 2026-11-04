package com.ishaanpilar.stride.contextautomation

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

private const val CONTEXT_AUTOMATION_HEADLESS_TASK_NAME = "StrideContextAutomation"
private const val CONTEXT_AUTOMATION_HEADLESS_TIMEOUT_MS = 15_000L

class ContextAutomationHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val action = intent?.getStringExtra("action")?.trim().orEmpty()
    val context = intent?.getStringExtra("context")?.trim().orEmpty()
    if (action.isBlank() || context.isBlank()) return null

    val data = Arguments.createMap().apply {
      putString("action", action)
      putString("context", context)
    }

    return HeadlessJsTaskConfig(
      CONTEXT_AUTOMATION_HEADLESS_TASK_NAME,
      data,
      CONTEXT_AUTOMATION_HEADLESS_TIMEOUT_MS,
      true
    )
  }
}
