version v1

const low = 1.50
const high = 2.00
const tiny = 0.000001

if has_real_margin() and real_margin_ratio() > low - high + tiny then
    return stay
end

return stay
