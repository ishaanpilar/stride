package com.ishaanpilar.stride.androidwidget

import android.content.Context
import android.content.ContextWrapper
import android.content.res.Resources
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WidgetLinkSchemeTest {
  @Test
  fun anAppLinkTakesTheAppsSchemeAndEverythingElseStays() {
    assertEquals("stride:///inbox", WidgetRenderer.linkInScheme("stride:///inbox", "stride"))
    assertEquals("stride-native-dev:///inbox", WidgetRenderer.linkInScheme("stride:///inbox", "stride-native-dev"))
    assertEquals("stride-upgradetest:///widget-list/next", WidgetRenderer.linkInScheme("stride:///widget-list/next", "stride-upgradetest"))
    assertEquals("stride-widget://task/t1", WidgetRenderer.linkInScheme("stride-widget://task/t1", "stride-native-dev"))
    assertEquals("https://example.com/", WidgetRenderer.linkInScheme("https://example.com/", "stride-native-dev"))
  }

  @Test
  fun rnsAppKeepsItsStrideLinks() {

    val context = ApplicationProvider.getApplicationContext<Context>()
    assertEquals("stride:///focus", WidgetRenderer.appIntent(context, "stride:///focus").dataString)
  }

  @Test
  fun anAppThatOverridesTheSchemeGetsItsOwnLinks() {

    val base = ApplicationProvider.getApplicationContext<Context>()
    @Suppress("DEPRECATION")
    val resources = object : Resources(base.assets, base.resources.displayMetrics, base.resources.configuration) {
      override fun getString(id: Int): String = if (id == R.string.stride_link_scheme) "stride-native-dev" else super.getString(id)
    }
    val context = object : ContextWrapper(base) {
      override fun getResources(): Resources = resources
    }
    val intent = WidgetRenderer.appIntent(context, "stride:///widget-list/next")
    assertEquals("stride-native-dev:///widget-list/next", intent.dataString)
    assertEquals("${base.packageName}.MainActivity", intent.component?.className)
  }
}
