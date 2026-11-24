
function satoriGeminiReadOnlySetup() {
  var lock = LockService.getScriptLock();
    lock.waitLock(30000);
      try {
          var props = PropertiesService.getScriptProperties();
              var existing = props.getProperty('SATORI_BOT_CLIENTS_JSON');
                  if (!existing) throw Error('MISSING_BOT_CONFIG');
                  
                      var clients = JSON.parse(existing);
                          if (!clients || typeof clients !== 'object' ||
                                  Array.isArray(clients)) throw Error('INVALID_BOT_CONFIG');
                                  
                                      var id = 'gemini_readonly_20261022';
                                          if (Object.prototype.hasOwnProperty.call(clients, id)) {
                                                throw Error('GEMINI_CLIENT_ALREADY_EXISTS');
                                                    }
                                                    
                                                        var parts = [];
                                                            for (var i = 0; i < 4; i++) {
                                                                  var part = Utilities.getUuid().replace(/-/g, '');
                                                                        if (!/^[a-f0-9]{32}$/i.test(part)) {
                                                                                throw Error('RANDOM_GENERATION_FAILED');
                                                                                      }
                                                                                            parts.push(part);
                                                                                                }
                                                                                                
                                                                                                    var secret = parts.join('');
                                                                                                        clients[id] = {
                                                                                                              enabled: true,
                                                                                                                    secret: secret,
                                                                                                                          scopes: ['orders:read', 'customers:read']
                                                                                                                              };
                                                                                                                              
                                                                                                                                  var updated = JSON.stringify(clients);
                                                                                                                                      if (updated.length > 8500) {
                                                                                                                                            throw Error('BOT_CONFIG_TOO_LARGE');
                                                                                                                                                }
                                                                                                                                                
                                                                                                                                                    props.setProperties({
                                                                                                                                                          SATORI_BOT_CLIENTS_JSON: updated,
                                                                                                                                                                SATORI_GEMINI_READONLY_TRANSFER_KEY: secret
                                                                                                                                                                    }, false);
                                                                                                                                                                    
                                                                                                                                                                        var check = JSON.parse(
                                                                                                                                                                              props.getProperty('SATORI_BOT_CLIENTS_JSON')
                                                                                                                                                                                  );
                                                                                                                                                                                      if (check[id].secret !== secret) {
                                                                                                                                                                                            throw Error('READBACK_FAILED');
                                                                                                                                                                                                }
                                                                                                                                                                                                
                                                                                                                                                                                                    console.log('GEMINI_READONLY_CLIENT_CREATED');
                                                                                                                                                                                                      } finally {
                                                                                                                                                                                                          lock.releaseLock();
                                                                                                                                                                                                            }
                                                                                                                                                                                                            }
                                                                                                                                                                                                            
                                                                                                                                                                                                            function satoriGeminiReadOnlyFinish() {
                                                                                                                                                                                                              var props = PropertiesService.getScriptProperties();
                                                                                                                                                                                                                var transfer = props.getProperty(
                                                                                                                                                                                                                    'SATORI_GEMINI_READONLY_TRANSFER_KEY'
                                                                                                                                                                                                                      );
                                                                                                                                                                                                                        if (!transfer) return;
                                                                                                                                                                                                                        
                                                                                                                                                                                                                          var clients = JSON.parse(
                                                                                                                                                                                                                              props.getProperty('SATORI_BOT_CLIENTS_JSON') || '{}'
                                                                                                                                                                                                                                );
                                                                                                                                                                                                                                  var client = clients.gemini_readonly_20261022;
                                                                                                                                                                                                                                  
                                                                                                                                                                                                                                    if (!client || client.secret !== transfer ||
                                                                                                                                                                                                                                          client.scopes.join(',') !== 'orders:read,customers:read') {
                                                                                                                                                                                                                                              throw Error('GEMINI_CLIENT_MISMATCH');
                                                                                                                                                                                                                                                }
                                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                  props.deleteProperty('SATORI_GEMINI_READONLY_TRANSFER_KEY');
                                                                                                                                                                                                                                                    console.log('GEMINI_TRANSFER_KEY_CLEANED');
                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                     {
  
}
