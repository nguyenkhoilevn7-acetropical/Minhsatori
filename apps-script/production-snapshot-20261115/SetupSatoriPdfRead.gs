
function setupSatoriPdfReadClient() {
  const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty("SATORI_BOT_CLIENTS_JSON");

      if (!raw) {
          throw new Error("Thiếu cấu hình Bot hiện tại. DỪNG.");
            }

              const clients = JSON.parse(raw);
                const keyId = "v2_pdf_reader";

                  if (!clients || Array.isArray(clients)) {
                      throw new Error("Cấu hình Bot không hợp lệ.");
                        }

                          let client = clients[keyId];

                            if (client) {
                                if (
                                      client.enabled === false ||
                                            !Array.isArray(client.scopes) ||
                                                  client.scopes.length !== 1 ||
                                                        client.scopes[0] !== "pdf:read" ||
                                                              typeof client.secret !== "string" ||
                                                                    client.secret.length < 32
                                                                        ) {
                                                                              throw new Error("Client PDF đã tồn tại nhưng cấu hình khác.");
                                                                                  }
                                                                                    } else {
                                                                                        client = {
                                                                                              enabled: true,
                                                                                                    scopes: ["pdf:read"],
                                                                                                          secret:
                                                                                                                  Utilities.getUuid().replace(/-/g, "") +
                                                                                                                          Utilities.getUuid().replace(/-/g, "")
                                                                                                                              };
                                                                                                                                  clients[keyId] = client;
                                                                                                                                    }

                                                                                                                                      const oldId = props.getProperty("SATORI_PDF_READ_KEY_ID");
                                                                                                                                        const oldSecret = props.getProperty("SATORI_PDF_READ_HMAC_SECRET");

                                                                                                                                          if (
                                                                                                                                              (oldId && oldId !== keyId) ||
                                                                                                                                                  (oldSecret && oldSecret !== client.secret)
                                                                                                                                                    ) {
                                                                                                                                                        throw new Error("Đã có cấu hình PDF khác. DỪNG.");
                                                                                                                                                          }

                                                                                                                                                            props.setProperties({
                                                                                                                                                                SATORI_BOT_CLIENTS_JSON: JSON.stringify(clients),
                                                                                                                                                                    SATORI_PDF_READ_KEY_ID: keyId,
                                                                                                                                                                        SATORI_PDF_READ_HMAC_SECRET: client.secret
                                                                                                                                                                          });

                                                                                                                                                                            console.log("PDF_CLIENT_READY");
                                                                                                                                                                              console.log("KEY_ID: " + keyId);
                                                                                                                                                                                console.log("SCOPE: pdf:read");
                                                                                                                                                                                  console.log("SECRET: HIDDEN");
                                                                                                                                                                                  }
