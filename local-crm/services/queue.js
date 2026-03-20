// ── Cola de cambios pendientes para sync con Google Sheets ──

class QueueService {
  constructor(excelService) {
    this.excel = excelService;
  }

  // Genera ID unico para cada item de la cola
  _generateId() {
    return 'Q-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
  }

  async enqueue(action, payload) {
    const ws = this.excel.workbook.getWorksheet('SYNC_QUEUE');
    const queueId = this._generateId();
    const timestamp = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    ws.addRow([queueId, timestamp, action, JSON.stringify(payload), 'PENDING', '']);
    await this.excel.save();
    console.log('[queue] Enqueued:', action, queueId);
    return queueId;
  }

  getPendingItems() {
    const rows = this.excel._getSheetRows('SYNC_QUEUE');
    return rows
      .filter(r => {
        const status = (r.values[4] || '').toString().trim();
        return status === 'PENDING';
      })
      .map(r => ({
        rowNumber: r.rowNumber,
        queueId: (r.values[0] || '').toString(),
        timestamp: (r.values[1] || '').toString(),
        action: (r.values[2] || '').toString(),
        payload: JSON.parse((r.values[3] || '{}').toString()),
        status: (r.values[4] || '').toString()
      }));
  }

  async markSynced(queueId, syncTimestamp) {
    const ws = this.excel.workbook.getWorksheet('SYNC_QUEUE');
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      if ((row.values[1] || '').toString() === queueId) {
        row.getCell(5).value = 'SYNCED';
        row.getCell(6).value = syncTimestamp || new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
      }
    });
    await this.excel.save();
  }

  async markFailed(queueId, error) {
    const ws = this.excel.workbook.getWorksheet('SYNC_QUEUE');
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      if ((row.values[1] || '').toString() === queueId) {
        row.getCell(5).value = 'FAILED';
        row.getCell(6).value = 'ERROR: ' + (error || 'unknown');
      }
    });
    await this.excel.save();
  }

  getStats() {
    const rows = this.excel._getSheetRows('SYNC_QUEUE');
    let pending = 0, synced = 0, failed = 0;
    for (const r of rows) {
      const status = (r.values[4] || '').toString().trim();
      if (status === 'PENDING') pending++;
      else if (status === 'SYNCED') synced++;
      else if (status === 'FAILED') failed++;
    }
    return { pending, synced, failed };
  }

  async clearOldSynced(keep) {
    keep = keep || 100;
    const ws = this.excel.workbook.getWorksheet('SYNC_QUEUE');
    const syncedRows = [];

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      if ((row.values[5] || '').toString().trim() === 'SYNCED') {
        syncedRows.push(rowNumber);
      }
    });

    if (syncedRows.length <= keep) return;

    // Eliminar los mas antiguos (primeras filas)
    const toRemove = syncedRows.slice(0, syncedRows.length - keep);
    // Splice de abajo hacia arriba para no desplazar indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      ws.spliceRows(toRemove[i], 1);
    }
    await this.excel.save();
    console.log('[queue] Cleaned', toRemove.length, 'old synced items');
  }
}

module.exports = { QueueService };
