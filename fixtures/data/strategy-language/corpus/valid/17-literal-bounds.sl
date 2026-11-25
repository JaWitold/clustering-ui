version v1

const max_int = 9223372036854775807
const min_int = -9223372036854775807
const big_decimal = 999999999999.999999
const aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa = 1

if my_price_in_cents() < max_int and my_price_in_cents() > min_int then
    return stay
end

if has_mapped_margin() and mapped_margin_ratio() < big_decimal and free_price_changes() > aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa then
    return stay
end

return stay
