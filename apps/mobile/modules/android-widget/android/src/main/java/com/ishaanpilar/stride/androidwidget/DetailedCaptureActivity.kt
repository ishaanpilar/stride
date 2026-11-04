package com.ishaanpilar.stride.androidwidget

import android.app.Activity
import android.os.Bundle


class DetailedCaptureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {

      startActivity(WidgetRenderer.appIntent(this, "stride:///capture-quick?mode=text&entry=details"))
    } finally {
      finish()
    }
  }
}
