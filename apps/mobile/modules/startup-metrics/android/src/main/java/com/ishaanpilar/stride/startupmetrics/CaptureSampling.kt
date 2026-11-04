package com.ishaanpilar.stride.startupmetrics

import androidx.annotation.Keep


@Keep
internal object CaptureSampling {
  init { System.loadLibrary("stride_capture_profiler") }
  external fun enable()
  external fun disable()
  external fun dump(filename: String)
}
