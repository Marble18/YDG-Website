(function () {
  'use strict';

  var TEMPLATE_URL = 'assets/YDG%20Product%20Export%20Template.xlsx';
  var HEADERS = ['No', 'Product Name', 'Product Photo', 'Category', 'Price', 'Stock', 'Unit'];

  function cloneStyle(style) {
    return style ? JSON.parse(JSON.stringify(style)) : {};
  }

  function toDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('A product photo could not be read.')); };
      reader.readAsDataURL(blob);
    });
  }

  async function excelImage(blob) {
    if (blob.type !== 'image/webp') {
      return { dataUrl: await toDataUrl(blob), extension: blob.type === 'image/png' ? 'png' : 'jpeg' };
    }
    var bitmap = await createImageBitmap(blob);
    var canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return { dataUrl: canvas.toDataURL('image/png'), extension: 'png' };
  }

  async function loadPhoto(workbook, url) {
    if (!url || !/^https:\/\//i.test(url)) return null;
    try {
      var response = await fetch(url, { mode: 'cors' });
      if (!response.ok) return null;
      var blob = await response.blob();
      if (!/^image\/(jpeg|png|webp)$/i.test(blob.type)) return null;
      var image = await excelImage(blob);
      return workbook.addImage({ base64: image.dataUrl, extension: image.extension });
    } catch (error) {
      return null;
    }
  }

  function safeFilePart(value) {
    return String(value || 'all-categories').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all-categories';
  }

  async function exportProducts(options) {
    if (!window.ExcelJS) throw new Error('Excel export tools did not load. Please refresh and try again.');
    var products = Array.isArray(options.products) ? options.products : [];
    if (!products.length) throw new Error('No products match the selected export options.');

    if (options.onStatus) options.onStatus('Loading the Excel template…');
    var templateResponse = await fetch(TEMPLATE_URL, { cache: 'no-store' });
    if (!templateResponse.ok) throw new Error('The Excel template could not be loaded.');
    var workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await templateResponse.arrayBuffer());
    var sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('The Excel template has no worksheet.');

    var headerStyles = [];
    var sampleStyles = [];
    for (var column = 1; column <= 6; column += 1) {
      headerStyles[column] = cloneStyle(sheet.getCell(1, column).style);
      sampleStyles[column] = cloneStyle(sheet.getCell(2, column).style);
    }
    var headerHeight = sheet.getRow(1).height || 29.4;
    var productHeight = sheet.getRow(2).height || 100.05;
    if (sheet.rowCount > 1) sheet.spliceRows(2, sheet.rowCount - 1);

    HEADERS.forEach(function (heading, index) {
      var cell = sheet.getCell(1, index + 1);
      cell.value = heading;
      cell.style = cloneStyle(headerStyles[Math.min(index + 1, 6)]);
    });
    sheet.getRow(1).height = headerHeight;
    sheet.getColumn(7).width = 12;

    if (options.onStatus) options.onStatus('Adding ' + products.length + ' product(s)…');
    for (var index = 0; index < products.length; index += 1) {
      var product = products[index];
      var rowNumber = index + 2;
      var row = sheet.getRow(rowNumber);
      row.height = productHeight;
      row.values = [index + 1, product.name, '', product.category, Number(product.price), Number(product.stock), product.unit === 'box' ? 'box' : 'pcs'];
      for (var cellIndex = 1; cellIndex <= 7; cellIndex += 1) {
        row.getCell(cellIndex).style = cloneStyle(sampleStyles[Math.min(cellIndex, 6)]);
      }
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'right' };
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell(3).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell(5).numFmt = '#,##0';
      row.getCell(6).numFmt = '#,##0';
      row.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };

      var imageId = await loadPhoto(workbook, product.photo);
      if (imageId !== null) {
        sheet.addImage(imageId, {
          tl: { col: 2.08, row: rowNumber - 0.92 },
          ext: { width: 190, height: 123 },
          editAs: 'oneCell'
        });
      } else {
        row.getCell(3).value = 'No photo';
      }
    }

    sheet.autoFilter = { from: 'A1', to: 'G' + (products.length + 1) };
    sheet.pageSetup = Object.assign({}, sheet.pageSetup || {}, {
      printArea: 'A1:G' + (products.length + 1),
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    if (options.onStatus) options.onStatus('Preparing the download…');
    var output = await workbook.xlsx.writeBuffer();
    var blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    var date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = 'ydg-products-' + safeFilePart(options.category) + '-' + date + '.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return { count: products.length, fileName: link.download };
  }

  window.ProductExportService = { exportProducts: exportProducts };
})();
