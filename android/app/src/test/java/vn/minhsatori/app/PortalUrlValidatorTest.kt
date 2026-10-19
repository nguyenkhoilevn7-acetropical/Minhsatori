package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PortalUrlValidatorTest {
    private val url = "https://script.google.com/macros/s/AKfycbExample-123_ABC/exec"
    private val workingUrl = "$url?authuser=0&pli=1"

    @Test fun acceptsCorrectOwnerDeploymentUrl() {
        assertEquals(url, PortalUrlValidator.normalize("  " + url + "  "))
    }

    @Test fun keepsChromeGoogleAccountParameters() {
        assertEquals(workingUrl, PortalUrlValidator.normalize(workingUrl))
        assertEquals(url + "?authuser=0", PortalUrlValidator.normalize(url + "?authuser=0"))
        assertEquals(url + "?pli=1&authuser=12", PortalUrlValidator.normalize(url + "?pli=1&authuser=12"))
    }

    @Test fun rejectsHttpAndOtherHosts() {
        assertNull(PortalUrlValidator.normalize("http://script.google.com/macros/s/ABC/exec"))
        assertNull(PortalUrlValidator.normalize("https://script.google.com.evil.example/macros/s/ABC/exec"))
        assertNull(PortalUrlValidator.normalize("https://evil.example/macros/s/ABC/exec"))
    }

    @Test fun rejectsUnexpectedQueryParameters() {
        assertNull(PortalUrlValidator.normalize(url + "?secret=exposed"))
        assertNull(PortalUrlValidator.normalize(url + "?authuser=0&pli=1&token=secret"))
        assertNull(PortalUrlValidator.normalize(url + "?authuser=0&authuser=1"))
        assertNull(PortalUrlValidator.normalize(url + "?authuser=hello@example.com"))
        assertNull(PortalUrlValidator.normalize(url + "?authuser=%30"))
        assertNull(PortalUrlValidator.normalize(url + "?authuser=0&pli=1#fragment"))
        assertNull(PortalUrlValidator.normalize(url + "?"))
        assertNull(PortalUrlValidator.normalize(url + "?pli=2"))
        assertNull(PortalUrlValidator.normalize(url + "?authuser=0&"))
        assertNull(PortalUrlValidator.normalize(url + "?%61uthuser=0"))
        assertNull(PortalUrlValidator.normalize(url + "?authuser=0&authuser=0"))
    }

    @Test fun rejectsOtherGooglePathsAndCredentials() {
        assertNull(PortalUrlValidator.normalize("https://script.google.com/d/projectid/edit"))
        assertNull(PortalUrlValidator.normalize("https://script.google.com/macros/s/ABC/dev"))
        assertNull(PortalUrlValidator.normalize("https://user@script.google.com/macros/s/ABC/exec"))
        assertNull(PortalUrlValidator.normalize("not a url"))
    }
}
