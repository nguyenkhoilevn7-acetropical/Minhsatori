package vn.minhsatori.app

import java.io.IOException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MobileRevisionTest {
    @Test fun canonicalRevisionParsesWhenPresent() {
        assertEquals(105L, MobileApiClient.parseRevision(JSONObject("""{"data":{"revision":105}}""")))
        assertEquals(0L, MobileApiClient.parseRevision(JSONObject("""{"data":{"revision":0}}""")))
    }

    @Test fun missingMalformedOrNegativeRevisionIsRejected() {
        listOf(
            """{}""", """{"data":{}}""",
            """{"data":{"revision":-1}}""",
            """{"data":{"revision":"105"}}""",
            """{"data":{"revision":1.5}}""",
            """{"data":{"revision":true}}"""
        ).forEach { body ->
            assertThrows(IOException::class.java) {
                MobileApiClient.parseRevision(JSONObject(body))
            }
        }
    }
}
