package com.ishaanpilar.stride.androidwidget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class WidgetNavigationTest {
  @Test
  fun tasksTitleAndBlankSpaceOpenTheListWhileChevronOpensChooser() {
    val payload = payloadWithLists()

    val actions = WidgetRenderer.tasksHeaderActions(payload, "inbox", appWidgetId = 42)

    assertEquals("stride:///inbox", actions.openList.uri)
    assertEquals(
      listOf(R.id.stride_widget_title_target),
      actions.openTargetIds,
    )
    assertEquals("stride:///inbox", actions.openHome.uri)
    assertEquals(
      listOf(R.id.stride_widget_root, R.id.stride_widget_empty, R.id.stride_widget_spacer),
      actions.openHomeTargetIds,
    )
    assertNotEquals(actions.openList.requestCode, actions.openHome.requestCode)
    assertEquals(R.id.stride_widget_chooser, actions.openChooserTargetId)
    assertNotEquals(actions.openList.requestCode, actions.openChooserRequestCode)
    assertNotEquals(actions.openHome.requestCode, actions.openChooserRequestCode)
    assertEquals("Change: Inbox", actions.chooserContentDescription)
  }

  @Test
  fun navigationPendingIntentIdentityIsUniquePerWidgetAndList() {
    val payload = payloadWithLists()

    val firstInbox = WidgetRenderer.tasksHeaderActions(payload, "inbox", appWidgetId = 42).openList
    val secondInbox = WidgetRenderer.tasksHeaderActions(payload, "inbox", appWidgetId = 43).openList
    val firstWaiting = WidgetRenderer.tasksHeaderActions(payload, "waiting", appWidgetId = 42).openList

    assertNotEquals(firstInbox.requestCode, secondInbox.requestCode)
    assertNotEquals(firstInbox.uri, firstWaiting.uri)
  }

  @Test
  fun blankSpaceFollowsEachTasksSelectionWhileCompactKeepsItsHomeRoute() {
    val payload = payloadWithLists()
    val focus = WidgetRenderer.tasksHeaderActions(payload, "focus", appWidgetId = 42)
    val inbox = WidgetRenderer.tasksHeaderActions(payload, "inbox", appWidgetId = 42)
    val saved = WidgetRenderer.tasksHeaderActions(payload, "filter:abc", appWidgetId = 42)
    val otherWidget = WidgetRenderer.tasksHeaderActions(payload, "inbox", appWidgetId = 43)
    val compact = WidgetRenderer.compactHeaderActions(payload, appWidgetId = 42)

    listOf(focus, inbox, saved, otherWidget).forEach { actions ->
      assertEquals(actions.openList.uri, actions.openHome.uri)
      assertNotEquals(actions.openList.requestCode, actions.openHome.requestCode)
    }
    assertEquals("stride:///inbox", inbox.openList.uri)
    assertEquals("stride:///widget-list/filter%3Aabc", saved.openList.uri)
    assertEquals(focus.openHome.requestCode, inbox.openHome.requestCode)
    assertEquals(inbox.openHome.requestCode, saved.openHome.requestCode)
    assertNotEquals(inbox.openHome.requestCode, otherWidget.openHome.requestCode)
    assertEquals("stride:///focus", compact.openHome.uri)
    assertEquals(listOf(R.id.stride_widget_title_target), compact.openTargetIds)

    val unsafePayload = payloadWithLists(rootFocusUri = "stride://evil.example/focus")
    assertEquals("stride:///inbox", WidgetRenderer.tasksHeaderActions(unsafePayload, "inbox", 42).openHome.uri)
  }

  @Test
  fun legacyListsUseOnlyTheSettledFixedAndSavedFilterRoutes() {
    val payload = payloadWithLists()

    assertEquals("stride:///focus", payload.openUriFor("focus"))
    assertEquals("stride:///inbox", payload.openUriFor("inbox"))
    assertEquals("stride:///widget-list/next", payload.openUriFor("next"))
    assertEquals("stride:///waiting", payload.openUriFor("waiting"))
    assertEquals("stride:///someday", payload.openUriFor("someday"))
    assertEquals("stride:///widget-list/filter%3Aabc", payload.openUriFor("filter:abc"))
    assertEquals("stride:///focus", payload.openUriFor("filter:"))
    assertEquals("stride:///focus", payload.openUriFor("filter:${"x".repeat(1_025)}"))
    assertEquals("stride:///focus", payload.openUriFor("filter:bad\u0000id"))
    assertEquals("stride:///focus", payload.openUriFor("project:untrusted"))

    val unsafeFallback = payloadWithLists(rootFocusUri = "stride://evil.example/focus")
    assertEquals("stride:///focus", unsafeFallback.openUriFor("focus"))
    assertEquals("stride:///focus", unsafeFallback.openUriFor("project:untrusted"))
  }

  @Test
  fun optionalPayloadRouteCannotReplaceASettledFixedDestination() {
    val payload = payloadWithLists(inboxUri = "stride:///widget-list/inbox")

    assertEquals("stride:///inbox", payload.openUriFor("inbox"))
  }

  @Test
  fun partialCompactChromeSwitchesItsLinkWithTheDisplayedFallbackList() {
    val payload = payloadWithLists(
      focusItems = listOf("focus-task"),
      nextItems = listOf("next-task"),
      focusUri = "stride:///focus",
      nextUri = "stride:///widget-list/next",
    )

    val before = WidgetRenderer.compactHeaderActions(payload, appWidgetId = 71).openList
    val after = WidgetRenderer.compactHeaderActions(
      payload.displaySnapshot(setOf("focus-task")).payload,
      appWidgetId = 71,
    ).openList

    assertEquals("stride:///focus", before.uri)
    assertEquals("stride:///widget-list/next", after.uri)
    assertEquals(before.requestCode, after.requestCode)
  }

  private fun payloadWithLists(
    focusItems: List<String> = emptyList(),
    nextItems: List<String> = emptyList(),
    focusUri: String? = null,
    nextUri: String? = null,
    inboxUri: String? = null,
    rootFocusUri: String = "stride:///focus",
  ): WidgetPayload {
    fun list(title: String, ids: List<String>, openUri: String?): JSONObject = JSONObject()
      .put("title", title)
      .put("items", JSONArray().apply {
        ids.forEach { id -> put(JSONObject().put("id", id).put("title", id)) }
      })
      .apply { if (openUri != null) put("openUri", openUri) }
    val lists = JSONObject()
      .put("focus", list("Focus", focusItems, focusUri))
      .put("inbox", list("Inbox", emptyList(), inboxUri))
      .put("next", list("Next Actions", nextItems, nextUri))
      .put("waiting", list("Waiting For", emptyList(), null))
      .put("someday", list("Someday/Maybe", emptyList(), null))
    return WidgetPayload.parse(JSONObject()
      .put("focusUri", rootFocusUri)
      .put("lists", lists)
      .put("listTitles", JSONObject()
        .put("focus", "Focus")
        .put("inbox", "Inbox")
        .put("next", "Next Actions")
        .put("waiting", "Waiting For")
        .put("someday", "Someday/Maybe"))
      .toString())!!
  }
}
