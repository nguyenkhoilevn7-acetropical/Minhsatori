function setupPdfRenderSecret() {
    const props = PropertiesService.getScriptProperties();
      const key = "SATORI_PDF_RENDER_SECRET";

        let secret = props.getProperty(key);

          if (!secret) {
              secret =
                    Utilities.getUuid().replace(/-/g, "") +
                          Utilities.getUuid().replace(/-/g, "");

                              props.setProperty(key, secret);
                                }

                                  console.log("PDF_RENDER_SECRET_READY");
                                    console.log("SECRET: HIDDEN");
                                    }

