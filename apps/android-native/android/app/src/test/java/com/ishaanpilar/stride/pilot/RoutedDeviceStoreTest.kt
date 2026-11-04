package com.ishaanpilar.stride.pilot

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import com.ishaanpilar.stride.pilot.core.RkStore
import com.ishaanpilar.stride.pilot.core.routedDeviceStore


class RoutedDeviceStoreTest {
    private val prefs = linkedMapOf<String, String>()
    private val rkStorage = Transactions()
    private val rk = rkStorage.values
    private val store = routedDeviceStore({ prefs }, { changes ->
        changes.forEach { (key, value) -> if (value == null) prefs.remove(key) else prefs[key] = value }
        true
    }, rkStorage)
    private fun writes(vararg pairs: Pair<String, String?>) = JSONArray().apply {
        pairs.forEach { (key, value) -> put(JSONObject().put("key", key).put("value", value ?: JSONObject.NULL)) }
    }

    @Test fun systemSearchKeysGoToRkStorageWithTheirSequence() {
        store.store(writes("stride:appSearchWipeOwed" to "true", "stride:appSearchIndexingEnabled" to null, "@stride_theme" to "dark"), 7, replay = false)
        assertEquals(mapOf("stride:appSearchWipeOwed" to "true", "stride:appSearchWipeOwed@journal" to "7", "stride:appSearchIndexingEnabled@journal" to "7"), rk)
        assertEquals(mapOf("@stride_theme" to "dark", "@stride_theme@journal" to "7"), prefs)
        assertEquals(7L, store.highestSequence())
    }

    @Test fun aReplayedOlderSwitchEditNeverWinsOverANewerOne() {
        store.store(writes("stride:appSearchWipeOwed" to "true", "stride:appSearchIndexingEnabled" to null), 9, replay = false)

        store.store(writes("stride:appSearchIndexingEnabled" to "true"), 4, replay = true)
        assertNull(rk["stride:appSearchIndexingEnabled"])
        assertEquals("true", rk["stride:appSearchWipeOwed"])
    }

    @Test fun anUpgradedRnUsersSwitchIsReadWhereRnLeftIt() {
        rk["stride:appSearchIndexingEnabled"] = "true"
        store.store(writes("stride:appSearchIndexingEnabled" to "true"), 3, replay = true)
        assertEquals("true", rk["stride:appSearchIndexingEnabled"])
        assertEquals(3L, store.highestSequence())
    }


    private class Transactions : RkStore {
        val committed = mutableListOf<Map<String, String?>>()
        val values = linkedMapOf<String, String>()
        override fun multiGet(keys: List<String>) = keys.associateWith { values[it] }
        override fun multiSet(entries: List<Pair<String, String>>) { committed += entries.toMap(); entries.forEach { (k, v) -> values[k] = v } }
        override fun multiRemove(keys: List<String>) { committed += keys.associateWith { null }; keys.forEach(values::remove) }
        override fun apply(changes: Map<String, String?>) { committed += changes; changes.forEach { (k, v) -> if (v == null) values.remove(k) else values[k] = v } }
    }

    @Test fun aSwitchOffIsOneRkStorageTransaction() {
        rk["stride:appSearchIndexingEnabled"] = "true"
        store.store(writes("stride:appSearchWipeOwed" to "true", "stride:appSearchIndexingEnabled" to null), 12, replay = false)
        assertEquals(1, rkStorage.committed.size)
        assertEquals(mapOf("stride:appSearchWipeOwed" to "true", "stride:appSearchWipeOwed@journal" to "12",
            "stride:appSearchIndexingEnabled" to null, "stride:appSearchIndexingEnabled@journal" to "12"), rkStorage.committed.single())
    }
}
