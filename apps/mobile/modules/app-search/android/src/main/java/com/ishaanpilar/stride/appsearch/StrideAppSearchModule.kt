package com.ishaanpilar.stride.appsearch

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StrideAppSearchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StrideAppSearch")

    Function("isSupported") {
      StrideAppSearchIndex.isSupported()
    }

    AsyncFunction("upsertDocuments") { docs: List<Map<String, Any?>>, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val parsed = docs.mapNotNull(StrideAppSearchDoc::fromMap)
      StrideAppSearchIndex.upsert(context, parsed) { result ->
        result.fold(
          onSuccess = { promise.resolve(null) },
          onFailure = { promise.reject("ERR_APPSEARCH_UPSERT", it.message, it) }
        )
      }
    }

    AsyncFunction("removeDocuments") { ids: List<String>, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      StrideAppSearchIndex.remove(context, ids) { result ->
        result.fold(
          onSuccess = { promise.resolve(null) },
          onFailure = { promise.reject("ERR_APPSEARCH_REMOVE", it.message, it) }
        )
      }
    }

    AsyncFunction("wipeAll") { promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      StrideAppSearchIndex.wipeAll(context) { result ->
        result.fold(
          onSuccess = { promise.resolve(null) },
          onFailure = { promise.reject("ERR_APPSEARCH_WIPE", it.message, it) }
        )
      }
    }
  }
}
