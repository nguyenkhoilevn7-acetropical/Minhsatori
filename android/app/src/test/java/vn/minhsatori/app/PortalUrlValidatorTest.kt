package vn.minhsatori.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PortalUrlValidatorTest {
    private val url = "https://script.google.com/macros/s/AKfycbExample-123_ABC/exec"

    @Test fun acceptsCorrectOwnerDeploymentUrl() {
        assertEquals(url, PortalUrlValidator.normalize("  " + url + "  "))
    }

    @Test fun rejectsHttpAndOtherHosts() {
        assertNull(PortalUrlValidator.normalize("http://script.google.com/macros/s/ABC/exec"))
        assertNull(PortalUrlValidator.normalize("https://script.google.com.evil.example/macros/s/ABC/exec"))
        assertNull(PortalUrlValidator.normalize("https://evil.example/macros/s/ABC/exec"))
    }

    @Test fun rejectsApiParametersFragmentsAndCredentials() {
        assertNull(PortalUrlValidator.normalize(url + "?secret=exposed"))
        assertNull(PortalUrlValidator.normalize(url + "#anything"))
        assertNull(PortalUrlValidator.normalize("https://user@script.google.com/macros/s/ABC/exec"))
    }

    @Test fun rejectsOtherGooglePaths() {
        assertNull(PortalUrlValidator.normalize("https://script.google.com/d/projectid/edit"))
        assertNull(PortalUrlValidator.normalize("https://script.google.com/macros/s/ABC/dev"))
        assertNull(PortalUrlValidator.normalize("not a url"))
    }
}
