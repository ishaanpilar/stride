package com.ishaanpilar.stride.notificationopenintents

import android.app.Application
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package


class NotificationOpenIntentsPackage : Package {
  override fun createApplicationLifecycleListeners(context: android.content.Context): List<ApplicationLifecycleListener> {
    return listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {


        Thread({
          try {
            PersistentCaptureNotifier.restoreOnProcessStart(application)
          } catch (_: Throwable) {
          }
        }, "stride-capture-repin").start()
      }
    })
  }
}
