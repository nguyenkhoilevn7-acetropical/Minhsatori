package vn.minhsatori.app

import android.content.Context
import android.graphics.Color
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Verified native order editor. Builds complete payloads; writes only via server API. */
object NativeOrderEditor {
    private fun dp(c: Context, x: Int) = (x * c.resources.displayMetrics.density + .5f).toInt()
    private fun title(a: AppCompatActivity, parent: LinearLayout, t: String, sz: Float = 13f): TextView {
        val v=TextView(a).apply {
            text=t
            textSize=sz
            setTextColor(Color.rgb(27,46,59))
            setPadding(0,dp(a,8),0,0)
        }
        parent.addView(v)
        return v
    }
    private fun input(a: AppCompatActivity,p: LinearLayout,label: String,
                      value: String="",numeric: Boolean=false,multi: Boolean=false): EditText {
        title(a,p,label,12f)
        return EditText(a).apply {
            hint=label
            setText(value)
            textSize=15f
            inputType=if(numeric) InputType.TYPE_CLASS_NUMBER else if(multi)
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            if(multi) { minLines=2;maxLines=4 }
            setBackgroundColor(Color.rgb(240,247,249))
            setPadding(dp(a,10),dp(a,6),dp(a,10),dp(a,6))
            p.addView(this,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(a,3)})
        }
    }
    private fun action(a:AppCompatActivity,p:LinearLayout,label:String,click:()->Unit){
        val b=Button(a).apply {
            text=label
            isAllCaps=false
            textSize=13f
            setOnClickListener{click()}
        }
        p.addView(b,LinearLayout.LayoutParams(-1,dp(a,45)).apply{topMargin=dp(a,8)})
    }
    private fun amount(s:String)=SatoriOrderValidation.amount(s)
    private data class Row(
        val view:LinearLayout,val name:EditText,val qty:EditText,val unit:EditText,
        val price:EditText,val listPrice:EditText,var code:String
    )
    fun show(
        a:AppCompatActivity,
        state:SatoriSnapshot,
        editing:SatoriInvoice?=null,
        customer:SatoriInvoice?=null,
        submit:(String,JSONObject,(Boolean,String)->Unit)->Unit
    ){
        val scroll=ScrollView(a)
        val page=LinearLayout(a).apply{
            orientation=LinearLayout.VERTICAL
            setPadding(dp(a,18),dp(a,12),dp(a,18),dp(a,20))
        }
        scroll.addView(page)
        title(a,page,if(editing==null)"LÊN ĐƠN MỚI" else "SỬA HÓA ĐƠN #"+editing.number,19f)
        title(a,page,"Đơn dùng revision "+state.revision,12f)
        val name=input(a,page,"Tên khách",editing?.customer?:customer?.customer.orEmpty())
        val phone=input(a,page,"Điện thoại",editing?.phone?:customer?.phone.orEmpty())
        val address=input(a,page,"Địa chỉ giao hàng",
            editing?.address?:customer?.address.orEmpty(),multi=true)
        val deliveryDate=input(a,page,"Ngày giao YYYY-MM-DD (tùy chọn)","")
        val note=input(a,page,"Ghi chú giao hàng (in trên PDF)",
            editing?.deliveryNote.orEmpty(),multi=true)
        var ref:SatoriInvoice?=editing?:customer
        val profiles=state.invoices.distinctBy{SatoriData.customerKey(it)}
            .sortedBy{SatoriData.normalized(it.customer)}
        val newBranch = CheckBox(a).apply {
            text = "Đây là KHÁCH MỚI / ĐIỂM GIAO MỚI (dù trùng tên)"
            textSize = 12f
            isChecked = false
        }
        page.addView(newBranch)
        action(a,page,"CHỌN KHÁCH / ĐỊA CHỈ GIAO"){
            AlertDialog.Builder(a).setTitle("Chọn đúng khách và điểm giao")
                .setItems(profiles.map{
                    it.customer+" · "+it.phone+"\n"+it.address
                }.toTypedArray()){_,idx->
                    val x=profiles[idx]
                    ref=x
                    name.setText(x.customer)
                    phone.setText(x.phone)
                    address.setText(x.address)
                    if(note.text.isBlank()&&SatoriData.normalized(x.customer).contains("oc q"))
                        note.setText("Shipper khi giao hàng phải mang theo hóa đơn có hiển thị đầy đủ số tiền thanh toán để người nhận kiểm tra.")
                }.setNegativeButton("Hủy",null).show()
        }
        title(a,page,"CHI TIẾT HÀNG HÓA",16f)
        val rows=mutableListOf<Row>()
        val items=LinearLayout(a).apply{orientation=LinearLayout.VERTICAL}
        page.addView(items)
        val total=title(a,page,"Tổng tiền: 0 đ",18f)
        var ship:EditText?=null
        var tax:EditText?=null
        fun totalGoods():Long=rows.fold(0L){acc,row->
            SatoriOrderValidation.sum(acc,SatoriOrderValidation.lineAmount(
                amount(row.qty.text.toString()),amount(row.price.text.toString())))
        }
        fun recalc(){
            val result=runCatching{
                SatoriOrderValidation.sum(totalGoods(),
                    amount(ship?.text?.toString().orEmpty()),
                    amount(tax?.text?.toString().orEmpty()))
            }
            total.text=result.fold(
                onSuccess={"TỔNG: "+SatoriData.money(it)},
                onFailure={"TỔNG: — (kiểm tra số lượng và đơn giá)"}
            )
        }
        fun watcher(e:EditText){
            e.addTextChangedListener(object:TextWatcher{
                override fun beforeTextChanged(s:CharSequence?,start:Int,count:Int,after:Int){}
                override fun onTextChanged(s:CharSequence?,start:Int,before:Int,count:Int){recalc()}
                override fun afterTextChanged(e:Editable?){}
            })
        }
        fun addRow(old:SatoriLine?=null){
            val card=LinearLayout(a).apply{
                orientation=LinearLayout.VERTICAL
                setPadding(dp(a,9),dp(a,9),dp(a,9),dp(a,9))
                setBackgroundColor(Color.rgb(236,244,247))
            }
            items.addView(card,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(a,8)})
            val product=input(a,card,"Tên sản phẩm",old?.description.orEmpty())
            val qty=input(a,card,"Số lượng",old?.quantity?.toString()?:"1",numeric=true)
            val unit=input(a,card,"Đơn vị",old?.unit?:"Thùng")
            val price=input(a,card,"Đơn giá (đ)",old?.unitPrice?.toString().orEmpty(),numeric=true)
            val list=input(a,card,"Giá niêm yết (đ)",old?.listPrice?.toString().orEmpty(),numeric=true)
            val entry=Row(card,product,qty,unit,price,list,old?.code.orEmpty())
            rows.add(entry)
            action(a,card,"CHỌN HÀNG TỪ DANH MỤC"){
                if(state.products.isEmpty()) Toast.makeText(a,"Danh mục chưa đồng bộ.",Toast.LENGTH_SHORT).show()
                else AlertDialog.Builder(a).setTitle("Chọn hàng Satori")
                    .setItems(state.products.map{it.name+" · "+SatoriData.money(it.unitPrice)}.toTypedArray()){_,i->
                        val x=state.products[i]
                        product.setText(x.name)
                        unit.setText(x.unit)
                        price.setText(x.unitPrice.toString())
                        list.setText(x.listPrice.toString())
                        entry.code=x.code
                        recalc()
                    }.setNegativeButton("Đóng",null).show()
            }
            action(a,card,"XÓA SẢN PHẨM NÀY"){
                if(rows.size==1)Toast.makeText(a,"Đơn cần ít nhất 1 sản phẩm.",Toast.LENGTH_SHORT).show()
                else{rows.remove(entry);items.removeView(card);recalc()}
            }
            watcher(qty);watcher(price);recalc()
        }
        if(editing==null||editing.lines.isEmpty())addRow() else editing.lines.forEach{addRow(it)}
        action(a,page,"+ THÊM SẢN PHẨM"){addRow()}
        ship=input(a,page,"Phí giao hàng (đ)",editing?.shipping?.toString()?:"0",numeric=true)
        tax=input(a,page,"VAT (đ)",editing?.vat?.toString()?:"0",numeric=true)
        watcher(ship!!);watcher(tax!!);recalc()
        val requestId=UUID.randomUUID().toString().replace("-","")
        // One durable request ID must always represent exactly one order payload.
        // Never allow an edited payload to reuse an ID after an ambiguous HTTP failure.
        var submittedPayload: String? = null
        val dialog=AlertDialog.Builder(a).setView(scroll)
            .setNegativeButton("Hủy",null)
            .setPositiveButton("KIỂM TRA & LƯU",null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                try{
                    val cleanName=name.text.toString().trim()
                    val cleanPhone=phone.text.toString().trim()
                    val cleanAddress=address.text.toString().trim()
                    require(cleanName.length in 2..150){"Cần tên khách hợp lệ."}
                    require(cleanAddress.length>=5){"Cần địa chỉ giao hàng."}
                    require(note.text.length<=1000){"Ghi chú tối đa 1.000 ký tự."}
                    require(rows.size in 1..50){"Danh sách sản phẩm không hợp lệ."}
                    val lines=JSONArray()
                    rows.forEach{
                        val product=it.name.text.toString().trim()
                        val qty=amount(it.qty.text.toString())
                        val price=amount(it.price.text.toString())
                        require(product.length>=2&&qty in 1L..100000L&&price<=10000000000L){
                            "Thiếu sản phẩm, sai số lượng hoặc đơn giá."
                        }
                        val listed=amount(it.listPrice.text.toString()).let{v->
                            if(v==0L)price else v
                        }
                        lines.put(JSONObject().put("product",product).put("code",it.code)
                            .put("qty",qty).put("unit",it.unit.text.toString().trim())
                            .put("unitPrice",price).put("listPrice",listed))
                    }
                    val shipping=amount(ship!!.text.toString())
                    val vat=amount(tax!!.text.toString())
                    val goods=totalGoods()
                    require(shipping<=100000000000L&&vat<=100000000000L&&
                        goods<=100000000000L&&goods+shipping+vat<=100000000000L){
                        "Tổng tiền vượt giới hạn."
                    }
                    val sum=SatoriOrderValidation.sum(goods,shipping,vat)
                    val dateText=SatoriOrderValidation.validDeliveryDate(deliveryDate.text.toString())
                    val order=JSONObject().put("name",cleanName).put("phone",cleanPhone)
                        .put("location",cleanAddress).put("items",lines)
                        .put("shippingAmount",shipping).put("vatAmount",vat)
                        .put("total",sum).put("deliveryNote",note.text.toString().trim())
                        .put("deliveryDate",dateText)
                    val payload=JSONObject().put("expectedRevision",state.revision)
                        .put("requestId",requestId).put("order",order)
                    if(editing!=null){
                        payload.put("id",editing.id).put("invoiceNo",editing.number.toInt())
                            .put("expectedName",editing.customer)
                            .put("expectedTotal",editing.total).put("confirmed",true)
                    } else {
                        val match=ref
                        val correct=match!=null&&
                            SatoriData.normalized(match.customer)==SatoriData.normalized(cleanName)&&
                            SatoriData.normalized(match.address)==SatoriData.normalized(cleanAddress)&&
                            match.phone.filter{it.isDigit()}==cleanPhone.filter{it.isDigit()}
                        if(correct&&match!=null){
                            payload.put("customerRef",JSONObject().put("id",match.id)
                                .put("invoiceNo",match.number))
                        }else{
                            val duplicatedName=profiles.any{
                                SatoriData.normalized(it.customer)==SatoriData.normalized(cleanName)
                            }
                            require(!duplicatedName||newBranch.isChecked){
                                "Tên khách đã có nhiều điểm giao. Chọn đúng điểm giao, " +
                                    "hoặc đánh dấu KHÁCH MỚI / ĐIỂM GIAO MỚI."
                            }
                            payload.put("confirmedNewCustomer",true)
                        }
                    }
                    val action = if (editing == null) "orders.create" else "orders.update"
                    require(!SatoriOrderValidation.requiresTestLedger(action, payload)) {
                        "Đơn có đánh dấu TEST chỉ được tạo trong môi trường thử, không lưu vào hóa đơn thật."
                    }
                    val preview=StringBuilder(if(editing==null)"TẠO HÓA ĐƠN" else "SỬA HÓA ĐƠN #"+editing.number)
                        .append("\nKhách: ").append(cleanName)
                        .append("\nSĐT: ").append(cleanPhone)
                        .append("\nGiao: ").append(cleanAddress)
                    for(i in 0 until lines.length()){
                        val line=lines.getJSONObject(i)
                        preview.append("\n").append(line.getString("product")).append(" × ")
                            .append(line.getInt("qty")).append(" = ")
                            .append(SatoriData.money(SatoriOrderValidation.lineAmount(line.getLong("qty"),line.getLong("unitPrice"))))
                    }
                    preview.append("\nTiền hàng: ").append(SatoriData.money(goods))
                        .append("\nPhí giao: ").append(SatoriData.money(shipping))
                        .append("\nVAT: ").append(SatoriData.money(vat))
                        .append("\nTỔNG THANH TOÁN: ").append(SatoriData.money(sum))
                    if(note.text.isNotBlank())preview.append("\nGHI CHÚ: ").append(note.text)
                    preview.append("\n\nXác nhận để lưu lên Google Drive.")
                    val confirm=AlertDialog.Builder(a).setTitle("XÁC NHẬN LƯU ĐƠN")
                        .setMessage(preview.toString()).setNegativeButton("Xem lại",null)
                        .setPositiveButton("LƯU ĐƠN",null).create()
                    confirm.setOnShowListener{
                        val save=confirm.getButton(AlertDialog.BUTTON_POSITIVE)
                        save.setOnClickListener{
                            val exactPayload = payload.toString()
                            if (submittedPayload != null && submittedPayload != exactPayload) {
                                Toast.makeText(a,
                                    "Nội dung đã đổi sau lần gửi trước. Hãy hủy, đồng bộ dữ liệu " +
                                        "rồi mở đơn mới; không gửi nội dung khác với cùng mã yêu cầu.",
                                    Toast.LENGTH_LONG).show()
                                return@setOnClickListener
                            }
                            submittedPayload = exactPayload
                            save.isEnabled=false
                            submit(if(editing==null)"orders.create" else "orders.update",payload){
                                success,message->
                                if(success){confirm.dismiss();dialog.dismiss()}
                                else{
                                    save.isEnabled=true
                                    Toast.makeText(a,message,Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    }
                    confirm.show()
                }catch(error:Exception){
                    Toast.makeText(a,error.message?:"Kiểm tra nội dung đơn.",Toast.LENGTH_LONG).show()
                }
            }
        }
        dialog.show()
    }
}
